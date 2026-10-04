"use client"

// Assignment corrections on a workplace (PRD AS-03, WF-13): the supervisor who
// has a worker here that the record places elsewhere raises a correction —
// not a manpower request, which Projects raises — and the HR manager corrects
// the assignment from the day named, or declines with a reason.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ArrowRightLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { hrPeopleScope } from "@/lib/hr/access"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, todayDay } from "@/lib/hr/format"
import { decideAssignFix, raiseAssignFix } from "@/lib/hr/site-writes"
import { assignFixBlocks, HR_ASSIGN_FIXES, type AssignFix, type HrSite } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"

const TONE = { pending: "warn", done: "ok", declined: "bad" } as const

export function HrAssignFixPanel({ access, actor, siteId, employees, sites }: { access: HrAccess; actor: HrActor; siteId: string; employees: HrEmployee[]; sites: HrSite[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const mayRaise = access.allowed("assignment.correct", { site: siteId })
  const mayDecide = access.allowed("employee.assign")
  const q = useMemoFirebase(
    () => (firestore && access.orgId ? query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", access.orgId), where("siteId", "==", siteId)) : null),
    [firestore, access.orgId, siteId]
  )
  const { data } = useCollection(q)
  const fixes = ((data ?? []) as unknown as AssignFix[]).slice().sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
  const [raising, setRaising] = useState(false)
  const [who, setWho] = useState("")
  // A supervisor reads only his own workplaces' records (RL-01): he names the worker by his ID number.
  const byId = hrPeopleScope(access.ctx) !== null
  const [idNo, setIdNo] = useState("")
  const [name, setName] = useState("")
  const [since, setSince] = useState(today)
  const [note, setNote] = useState("")
  const [declining, setDeclining] = useState<AssignFix | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? t("sites.unassigned")

  // Someone the record places elsewhere, still on the books.
  const candidates = useMemo(() => employees.filter((e) => e.status !== "left" && e.siteId !== siteId && e.names), [employees, siteId])
  const picked = candidates.find((e) => e.id === who) ?? null
  const typedId = idNo.replace(/\s+/g, "")
  const blocks = byId
    ? assignFixBlocks({ siteId: null, status: "active" }, siteId, since || null, today, fixes.some((f) => f.idNo === typedId && f.state === "pending"))
    : picked
      ? assignFixBlocks(picked, siteId, since || null, today, fixes.some((f) => f.employeeId === picked.id && f.state === "pending"))
      : []
  const ready = byId ? Boolean(typedId && name.trim()) : Boolean(picked)

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    if (!firestore || !access.orgId) return false
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `fix.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!mayRaise && fixes.length === 0) return null

  return (
    <Panel
      title={t("fix.title")}
      icon={ArrowRightLeft}
      count={fixes.filter((f) => f.state === "pending").length || undefined}
      actions={
        mayRaise ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setWho("")
              setIdNo("")
              setName("")
              setSince(today)
              setNote("")
              setRaising(true)
            }}
          >
            {t("fix.raise")}
          </Button>
        ) : null
      }
    >
      {fixes.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t("fix.none")}</p>
      ) : (
        <ul className="divide-y">
          {fixes.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <div className="min-w-0 flex-1 basis-60">
                <p className="font-semibold" dir="auto">
                  {f.employeeName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.employeeId
                    ? t("fix.line", { from: siteName(f.fromSiteId), since: hrDate(f.since, locale), name: f.byName || "—" })
                    : t("fix.line_by_id", { idNo: f.idNo ?? "—", since: hrDate(f.since, locale), name: f.byName || "—" })}
                  {f.note ? ` · ${f.note}` : ""}
                  {f.decision?.note ? ` · “${f.decision.note}”` : ""}
                </p>
              </div>
              <StatusPill tone={TONE[f.state]}>{t(`fix.state.${f.state}`)}</StatusPill>
              {f.state === "pending" && mayDecide && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => void run(() => decideAssignFix(firestore!, access.ctx, f.id, actor, "approve", ""), "fix.corrected")}>
                    {t("fix.correct")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setReason("")
                      setDeclining(f)
                    }}
                  >
                    {t("fix.decline")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={raising} onOpenChange={(o) => !o && setRaising(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fix.raise")}</DialogTitle>
            <DialogDescription>{t("fix.raise_desc", { site: siteName(siteId) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {byId ? (
              <>
                <p className="text-xs text-muted-foreground">{t("fix.by_id_hint")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="fx-id">{t("fix.id_no")}</Label>
                  <Input id="fx-id" inputMode="numeric" dir="ltr" value={idNo} onChange={(e) => setIdNo(e.target.value)} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fx-name">{t("fix.name")}</Label>
                  <Input id="fx-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="fx-who">{t("fix.who")}</Label>
                <SearchableSelect
                  id="fx-who"
                  value={who}
                  onChange={setWho}
                  options={candidates.map((e) => ({ value: e.id, label: `${empNo(e.no)} · ${displayName(e, locale)} — ${siteName(e.siteId)}` }))}
                  placeholder={t("fix.pick")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                  disabled={busy}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="fx-since">{t("fix.since")}</Label>
              <Input id="fx-since" type="date" dir="ltr" max={today} value={since} onChange={(e) => setSince(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-note">{t("req.note")}</Label>
              <Textarea id="fx-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
            <p className="text-xs text-muted-foreground">{t("fix.not_manpower")}</p>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`fix.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaising(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || !ready || blocks.length > 0}
              onClick={() =>
                void run(
                  () => raiseAssignFix(firestore!, access.ctx, access.orgId!, actor, { ...(byId ? { idNo: typedId, name } : { employeeId: who }), siteId, since, note }),
                  "fix.raised"
                ).then((ok) => ok && setRaising(false))
              }
            >
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("fix.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declining !== null} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fix.decline")}</DialogTitle>
            <DialogDescription dir="auto">{declining?.employeeName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="fx-why">{t("req.reason_required")}</Label>
            <Textarea id="fx-why" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => void run(() => decideAssignFix(firestore!, access.ctx, declining!.id, actor, "decline", reason), "fix.declined").then((ok) => ok && setDeclining(null))}
            >
              {t("fix.decline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
