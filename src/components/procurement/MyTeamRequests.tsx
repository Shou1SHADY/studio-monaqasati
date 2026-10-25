"use client"

// «طلباتي» — the member's own material requests and where each stands (Procurement 2.0, REQ-01): four steps — عند المشتريات ·
// في عروض · في أمر · وصلت — and one line saying what that means now. Never a price, never a supplier: those stay with Procurement.
// A request raised for him by a buyer is here too. Read from the server (/api/procurement/team-requests), which reads the RFQs and
// orders a member may not read himself. «اسحبه» while nobody has put it in an RFQ.

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Check, ClipboardList, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { displayNeedRef, displayPoNumber, fmtDayLong } from "@/lib/procurement/format"
import { requesterLine } from "@/lib/procurement/my-request-line"
import { REQUESTER_STEPS, type MyRequest, type RequesterStep } from "@/lib/procurement/incoming-state"
import { siteLine } from "@/lib/procurement/delivery-sites"
import { displayCity } from "@/lib/constants"
import { TeamApprovalsSection } from "@/components/procurement/TeamApprovalsSection"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import type { TeamApprovalView } from "@/lib/procurement/team-approval"

type Mine = MyRequest

const STEP_INDEX: Record<RequesterStep, number> = { placed: 0, rfq: 1, order: 2, arrived: 3, failed: -1, withdrawn: -1 }

export function StepBar({ step, label }: { step: RequesterStep; label: (s: (typeof REQUESTER_STEPS)[number]) => string }) {
  const at = STEP_INDEX[step]
  const ended = at < 0
  return (
    <ol className="flex items-center gap-1" aria-label={label("placed")}>
      {REQUESTER_STEPS.map((s, i) => {
        const done = !ended && i < at
        const now = !ended && i === at
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={now ? "step" : undefined}>
            <span className={cn("h-1.5 rounded-full", done || now ? "bg-module" : "bg-muted")} />
            <span className={cn("flex items-center gap-1 truncate text-[11px] font-semibold", now ? "text-module" : done ? "text-foreground" : "text-muted-foreground")}>
              {done && <Check size={11} aria-hidden="true" />}
              {label(s)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function MyTeamRequests({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("Portal.ProcMyRequests")
  const locale = useLocale()
  const { toast } = useToast()
  const [rows, setRows] = useState<Mine[] | null>(null)
  // The requests still before Procurement (REQ-05): those he approves, and his own waiting or returned.
  const [approvals, setApprovals] = useState<TeamApprovalView[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  // The signed-in user may arrive after the first render: the list loads once he does, never spins forever.
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const load = useCallback(async () => {
    if (!user) return
    const token = await user.getIdToken().catch(() => "")
    const res = token ? await fetch("/api/procurement/team-requests", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null) : null
    const body = res && res.ok ? ((await res.json().catch(() => null)) as { data?: { requests?: Mine[]; approvals?: TeamApprovalView[] } } | null) : null
    setRows(body?.data?.requests || [])
    setApprovals(body?.data?.approvals || [])
  }, [user])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const withdraw = async (r: Mine) => {
    const current = getAuth().currentUser
    if (!current || !window.confirm(t("withdraw_confirm", { number: displayNeedRef(r.no, locale) }))) return
    setBusy(r.id)
    try {
      const res = await fetch("/api/procurement/team-requests", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await current.getIdToken()}` }, body: JSON.stringify({ action: "withdraw", id: r.mrKey }) })
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (res.ok) toast({ title: t("withdrawn") })
      else toast({ title: body?.code === "IN_RFQ" ? t("withdraw_in_rfq") : t("failed"), variant: "destructive" })
      await load()
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  if (rows == null)
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-card p-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} aria-label={t("loading")} />
      </div>
    )
  const section = <TeamApprovalsSection approvals={approvals} orgId={organizationId || ""} onChanged={() => void load()} />
  if (!rows.length)
    return (
      <div className="space-y-4">
        {section}
        {!approvals.some((a) => a.mine) && <EmptyState icon={ClipboardList} title={t("none")} description={t("none_hint")} />}
      </div>
    )

  const label = (s: (typeof REQUESTER_STEPS)[number]) => t(`step_${s}`)
  return (
    <div className="space-y-4">
      {section}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="flex flex-wrap items-center gap-2">
                  <b className="text-base" dir="auto">
                    {displayNeedRef(r.no, locale)}
                  </b>
                  <span className="text-sm font-semibold" dir="auto">
                    {r.place.label}
                    {siteLine(r.place, (c) => displayCity(c, locale)) ? ` — ${siteLine(r.place, (c) => displayCity(c, locale))}` : ""}
                  </span>
                  {r.step === "failed" && <StatusPill tone="bad">{t("step_failed")}</StatusPill>}
                  {r.step === "withdrawn" && <StatusPill tone="mute">{t("step_withdrawn")}</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sent_on", { date: fmtDayLong(r.createdAt.slice(0, 10), locale, false), needBy: fmtDayLong(r.needBy, locale, false) })}
                  {r.requestedBy && r.requestedFor.name && r.requestedBy !== r.requestedFor.name ? ` · ${t("raised_for", { who: r.requestedFor.name, by: r.requestedBy })}` : ""}
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
                  {r.lines.map((l, i) => (
                    <span key={i}>
                      {l.name} <b className="tabular-nums" dir="ltr">{l.qty.toLocaleString("en-US")}</b> <span className="text-xs text-muted-foreground">{l.unit}</span>
                    </span>
                  ))}
                </p>
              </div>
              {r.withdrawable && (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void withdraw(r)} className="gap-1.5">
                  {busy === r.id && <Loader2 size={13} className="animate-spin" />}
                  {t("withdraw")}
                </Button>
              )}
            </div>
            <StepBar step={r.step} label={label} />
            <p className={cn("text-xs font-semibold", r.step === "failed" ? "text-destructive" : "text-muted-foreground")} dir="auto">
              {(() => {
                const line = requesterLine(r, (d) => fmtDayLong(d, locale, false), (n) => displayPoNumber(n, locale))
                return t(line.key, line.values)
              })()}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
