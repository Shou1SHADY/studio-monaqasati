"use client"

// Requests as a list (PRD §5 "Requests", LV-05, WF-07/08): number, person,
// what is asked, where it stands, and only the actions this viewer holds —
// endorse, approve, decline (a reason is required), cancel before it starts.
// An advance's amount shows only to those who may see pay.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { cancelRequest, decideRequest, endorseRequest } from "@/lib/hr/request-writes"
import { requestActions, requestNoDisplay, type HrRequest, type HrRequestState, type RequestAction } from "@/lib/hr/requests"
import { HrWriteError } from "@/lib/hr/write-guard"
import type { HrPortal } from "./HrShell"

export const REQUEST_TONE: Record<HrRequestState, PillTone> = { pending: "warn", endorsed: "info", approved: "ok", declined: "bad", finance: "violet", cancelled: "mute" }

type Acting = { r: HrRequest; action: Exclude<RequestAction, "finance"> }

export function HrRequestList({ access, requests, portal, showEmployee = true, empty }: { access: HrAccess; requests: HrRequest[]; portal?: HrPortal; showEmployee?: boolean; empty: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const today = todayDay()
  const [acting, setActing] = useState<Acting | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }

  const what = (r: HrRequest) => {
    if (r.kind === "leave" && r.leave) return `${t(`leave_type.${r.leave.type}`)} · ${hrDate(r.leave.from, locale)} → ${hrDate(r.leave.to, locale)} · ${t("file.days", { n: r.leave.days })}`
    if (r.kind === "advance" && r.advance) return `${t("req.kind.advance")}${access.seesPay(r.employeeId) ? ` · ${hrMoney(r.advance.amount)}` : ""}`
    if (r.kind === "data" && r.data) return `${t("req.kind.data")} · ${t(`data_field.${r.data.field}`)}: ${r.data.field === "iban" && !access.seesPay(r.employeeId) ? "•••" : r.data.value}${r.data.document ? ` · ${t("req.document_ref", { ref: r.data.document })}` : ""}`
    return t(`req.kind.${r.kind}`)
  }

  const run = async () => {
    if (!firestore || !acting) return
    const { r, action } = acting
    setBusy(true)
    try {
      if (action === "endorse") await endorseRequest(firestore, access.ctx, r.id, actor, note)
      else if (action === "cancel") await cancelRequest(firestore, access.ctx, r.id, actor, note)
      else {
        const res = await decideRequest(firestore, access.ctx, r.id, actor, action, note, { policies: access.settings.policies })
        if (res.state === "finance") {
          toast({ title: t("req.to_finance") })
          setActing(null)
          return
        }
      }
      toast({ title: t(`req.done.${action}`) })
      setActing(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `req.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (requests.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>

  const needsNote = acting?.action === "decline" || acting?.action === "cancel"

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {requests.map((r) => {
          const acts = requestActions(access.ctx, r, { today, financeAllowed: false }).filter((a): a is Acting["action"] => a !== "finance")
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-60 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold tabular-nums" dir="ltr">
                    {requestNoDisplay(r.no, locale)}
                  </span>
                  {showEmployee &&
                    (portal ? (
                      <Link href={`/${portal}/hr/people/${r.employeeId}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                        {r.employeeName}
                      </Link>
                    ) : (
                      <span className="font-semibold" dir="auto">
                        {r.employeeName}
                      </span>
                    ))}
                  <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                  {r.deciderLevel === "management" && <StatusPill tone="violet">{t("req.to_management")}</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground">{what(r)}</p>
                {(r.decision?.note || r.finance?.note || r.cancel?.note) && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    “{r.finance?.note || r.cancel?.note || r.decision?.note}”
                  </p>
                )}
              </div>
              {acts.length > 0 && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {acts.map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      variant={a === "approve" || a === "endorse" ? "default" : "outline"}
                      onClick={() => {
                        setNote("")
                        setActing({ r, action: a })
                      }}
                    >
                      {t(`req.act.${a}`)}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acting ? t(`req.act.${acting.action}`) : ""}</DialogTitle>
            <DialogDescription>{acting ? `${requestNoDisplay(acting.r.no, locale)} · ${acting.r.employeeName} · ${what(acting.r)}` : ""}</DialogDescription>
          </DialogHeader>
          {acting?.r.kind === "advance" && acting.action === "approve" && acting.r.advance?.overLimit && <p className="text-sm text-muted-foreground">{t("req.over_limit_note")}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="req-note">{t(needsNote ? "req.reason_required" : "req.note")}</Label>
            <Textarea id="req-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void run()} disabled={busy || (needsNote && !note.trim())} variant={acting?.action === "decline" || acting?.action === "cancel" ? "destructive" : "default"}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {acting ? t(`req.act.${acting.action}`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
