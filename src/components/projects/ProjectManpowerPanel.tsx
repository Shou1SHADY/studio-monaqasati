"use client"

// A project's manpower requests (HR PRD AS-02, WF-12), as Projects sees them:
// the project asks HR for a trade, a count and a start date, and reads HR's
// answer — the coverage plan with its honest dates. Covering it is HR's; the
// project never assigns people itself.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { CoverageLines } from "@/components/hr/HrManpowerPanel"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { HR_SITES } from "@/lib/hr/collections"
import { hrDate, todayDay } from "@/lib/hr/format"
import { MANPOWER_REQUESTS, manpowerBlocks, raiseManpowerRequest, type ManpowerRequest } from "@/lib/hr/manpower"
import type { HrSite } from "@/lib/hr/sites"
import { TRADES } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"

export function ProjectManpowerPanel({ projectId, projectName, organizationId, isPm }: { projectId: string; projectName: string; organizationId: string; isPm?: boolean }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { can, profile } = usePermissions(projectId)
  const { toast } = useToast()
  const allowed = can("projects.edit") || Boolean(isPm)
  const q = useMemoFirebase(
    () => (firestore && organizationId ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", organizationId), where("projectId", "==", projectId)) : null),
    [firestore, organizationId, projectId]
  )
  const { data } = useCollection(q)
  const requests = ((data ?? []) as unknown as ManpowerRequest[]).sort((a, b) => (b.requested?.at ?? "").localeCompare(a.requested?.at ?? ""))
  const sQ = useMemoFirebase(() => (firestore && organizationId ? query(collection(firestore, HR_SITES), where("organizationId", "==", organizationId), where("projectId", "==", projectId)) : null), [firestore, organizationId, projectId])
  const { data: sData } = useCollection(sQ)
  const site = ((sData ?? []) as unknown as HrSite[])[0] ?? null
  const [open, setOpen] = useState(false)
  const [trade, setTrade] = useState("")
  const [count, setCount] = useState("1")
  const [from, setFrom] = useState(todayDay())
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const blocks = manpowerBlocks({ trade, count: Number(count), from })

  const save = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await raiseManpowerRequest(firestore, { uid: user?.uid ?? "", name: (profile?.name as string) || null, allowed }, organizationId, { projectId, projectName, siteId: site?.id ?? null, trade, count: Number(count), from, note })
      toast({ title: t("mp.sent_ok") })
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t("mp.project_title")}
      icon={UsersRound}
      count={requests.filter((r) => r.state === "open").length || undefined}
      actions={
        allowed ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("mp.ask")}
          </Button>
        ) : null
      }
    >
      {requests.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t("mp.none")}</p>
      ) : (
        <ul className="divide-y">
          {requests.map((r) => (
            <li key={r.id} className="space-y-1 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                {t("mp.line", { count: r.count, trade: t(`trade.${r.trade}` as "trade.mason"), date: hrDate(r.from, locale) })}
                <StatusPill tone={r.state === "open" ? "warn" : r.state === "answered" ? "ok" : "mute"}>{t(`mp.state.${r.state}`)}</StatusPill>
              </p>
              {r.answer ? (
                <>
                  <CoverageLines lines={r.answer.plan} excluded={r.answer.excluded} />
                  {r.answer.note && (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {t("mp.hr_note", { note: r.answer.note, name: r.answer.byName || "—" })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("mp.waiting_hr")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {!site && <p className="pt-2 text-[11px] text-muted-foreground">{t("mp.no_site")}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mp.ask")}</DialogTitle>
            <DialogDescription>{t("mp.ask_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-trade">{t("new.trade")}</Label>
              <SearchableSelect
                id="mp-trade"
                value={trade}
                onChange={setTrade}
                options={TRADES.map((x) => ({ value: x.key, label: t(`trade.${x.key}` as "trade.mason") }))}
                placeholder={t("new.pick_trade")}
                searchPlaceholder={t("search")}
                noResultsText={t("no_results")}
                disabled={busy}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mp-count">{t("mp.count")}</Label>
                <Input id="mp-count" type="number" min="1" step="1" dir="ltr" value={count} onChange={(e) => setCount(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mp-from">{t("mp.from")}</Label>
                <Input id="mp-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-note2">{t("req.note")}</Label>
              <Textarea id="mp-note2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
            <BlockingReasons title={t("req.cannot_send")} reasons={blocks.map((b) => t(`mp.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("req.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
