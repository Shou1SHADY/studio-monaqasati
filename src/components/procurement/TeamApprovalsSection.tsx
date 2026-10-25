"use client"

// The team requests still before Procurement (REQ-05), on «طلباتي»: for the APPROVER — «بانتظار اعتمادك», each with its materials,
// place, need-by date and days waiting, «اعتمد» or «أعده» with a reason (Today's row lands here, `?approval={id}`); for the
// REQUESTER — his own, «مع فلان للاعتماد» with «اسحبه», or returned with the reason and «عدّل وأرسله». Written by the server.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Hourglass, Loader2, Undo2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { Chip } from "@/components/module-ui/Chip"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { TeamRequestDialog } from "@/components/procurement/TeamRequestDialog"
import { displayNeedRef, fmtDayLong } from "@/lib/procurement/format"
import { RETURN_OTHER_MIN, RETURN_REASONS, type ReturnReason, type TeamApprovalView } from "@/lib/procurement/team-approval"
import { approveTeamRequestCall, returnTeamRequestCall, withdrawTeamRequestCall } from "@/lib/procurement/team-approval-client"
import { cn } from "@/lib/utils"

export function TeamApprovalsSection({ approvals, orgId, onChanged }: { approvals: TeamApprovalView[]; orgId: string; onChanged: () => void }) {
  const t = useTranslations("Portal.ProcMyRequests")
  const locale = useLocale()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [code, setCode] = useState<ReturnReason | null>(null)
  const [note, setNote] = useState("")
  const [editing, setEditing] = useState<TeamApprovalView | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => setFocus(new URLSearchParams(window.location.search).get("approval")), [])

  const toDecide = approvals.filter((a) => a.canDecide)
  const mine = approvals.filter((a) => a.mine && !a.canDecide)
  if (!toDecide.length && !mine.length) return null
  const day = (d: string) => fmtDayLong(d.slice(0, 10), locale, false)
  const names = (list: string[]) => list.join(locale === "ar" ? " أو " : " or ")
  const ready = code != null && (code !== "other" || note.trim().length >= RETURN_OTHER_MIN)

  const act = async (id: string, run: () => Promise<{ ok: true } | { ok: false; code: string }>, done: string) => {
    setBusy(id)
    const res = await run()
    setBusy(null)
    if (res.ok) {
      toast({ title: t(done) })
      setReturning(null)
      setCode(null)
      setNote("")
      onChanged()
    } else toast({ title: t(res.code === "OWN_REQUEST" ? "appr_err_own" : res.code === "NOT_WAITING" ? "appr_err_moved" : "failed"), variant: "destructive" })
  }

  const materials = (a: TeamApprovalView) => (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
      {a.lines.map((l, i) => (
        <span key={i}>
          {l.name} <b className="tabular-nums" dir="ltr">{l.qty.toLocaleString("en-US")}</b> <span className="text-xs text-muted-foreground">{l.unit}</span>
        </span>
      ))}
    </p>
  )

  return (
    <div className="space-y-4">
      {toDecide.length > 0 && (
        <section className="space-y-2" aria-labelledby="appr-mine">
          <h2 id="appr-mine" className="flex items-center gap-2 text-base font-black">
            <Hourglass size={15} className="text-module" aria-hidden="true" />
            {t("appr_title")}
            <span className="rounded-full bg-module/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-module">{toDecide.length}</span>
          </h2>
          <ul className="space-y-3">
            {toDecide.map((a) => (
              <li key={a.id} className={cn("space-y-2 rounded-2xl border bg-card p-4", focus === a.id && "border-module/50 ring-2 ring-module/30")} data-testid={`approval-${a.id}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <b className="text-base" dir="auto">
                    {displayNeedRef(a.no, locale)}
                  </b>
                  <span className="text-sm font-semibold" dir="auto">
                    {a.place.label}
                  </span>
                  <StatusPill tone={a.overdue ? "bad" : "warn"}>{t("appr_waiting", { days: a.waitingDays })}</StatusPill>
                </p>
                <p className="text-xs text-muted-foreground">{t("appr_meta", { name: a.requestedFor || a.requestedBy, date: day(a.sentAt), needBy: day(a.needBy) })}</p>
                {materials(a)}
                {a.note && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {a.note}
                  </p>
                )}
                {returning === a.id ? (
                  <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs font-bold">{t("appr_return_why")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {RETURN_REASONS.map((r) => (
                        <Chip key={r} selected={code === r} onClick={() => setCode(r)}>
                          {t(`appr_reason_${r}`)}
                        </Chip>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`appr-note-${a.id}`} className="text-xs">
                        {code === "other" ? t("appr_note_required") : t("appr_note")}
                      </Label>
                      <Input id={`appr-note-${a.id}`} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" maxLength={500} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setReturning(null)} disabled={busy === a.id}>
                        {t("appr_cancel")}
                      </Button>
                      <Button size="sm" disabled={!ready || busy === a.id} onClick={() => code && void act(a.id, () => returnTeamRequestCall(a.id, code, note.trim() || null), "appr_returned")} className="gap-1.5">
                        {busy === a.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
                        {t("appr_return_send")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="success" disabled={busy === a.id} onClick={() => void act(a.id, () => approveTeamRequestCall(a.id), "appr_approved")} className="gap-1.5">
                      {busy === a.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                      {t("appr_approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setReturning(a.id)}>
                      {t("appr_return")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && (
        <section className="space-y-2" aria-labelledby="appr-own">
          <h2 id="appr-own" className="text-base font-black">
            {t("appr_own_title")}
          </h2>
          <ul className="space-y-3">
            {mine.map((a) => (
              <li key={a.id} className="space-y-2 rounded-2xl border bg-card p-4" data-testid={`own-approval-${a.id}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <b className="text-base" dir="auto">
                    {displayNeedRef(a.no, locale)}
                  </b>
                  <span className="text-sm font-semibold" dir="auto">
                    {a.place.label}
                  </span>
                  <StatusPill tone={a.st === "ret" ? "bad" : "warn"}>{a.st === "ret" ? t("appr_st_ret") : t("appr_st_wait")}</StatusPill>
                </p>
                {materials(a)}
                {a.st === "ret" && a.returned ? (
                  <Callout tone="warn">{t("appr_returned_line", { name: a.returned.byName, why: a.returned.why })}</Callout>
                ) : (
                  <p className="text-xs font-semibold text-muted-foreground">{t("appr_with", { names: names(a.approvers) || "—", days: a.waitingDays })}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {a.st === "ret" && (
                    <Button size="sm" onClick={() => setEditing(a)}>
                      {t("appr_edit_resend")}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => window.confirm(t("withdraw_confirm", { number: displayNeedRef(a.no, locale) })) && void act(a.id, () => withdrawTeamRequestCall(a.mrKey), "withdrawn")}>
                    {t("withdraw")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <TeamRequestDialog
          key={editing.id}
          open
          editing={editing}
          orgId={orgId}
          onOpenChange={(o) => !o && setEditing(null)}
          onSent={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
