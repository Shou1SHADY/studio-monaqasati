"use client"

// «طلباتي» — the team member's own «طلب مواد» and what became of each (Procurement 1.5, PUR-10):
// أُرسل · في عروض · في أمر · في الطريق · استُلم · تعذّر الشراء (with the reason) · سحبته. Read from the
// server (/api/procurement/team-requests), which reads the RFQs and orders a member may not read
// himself — and never their prices. «اسحبه» while nobody has put it in an RFQ.

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { ClipboardList, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { displayNeedRef, displayPoNumber, fmtDayLong } from "@/lib/procurement/format"
import type { TeamRequestDoc, TeamRequestState } from "@/lib/procurement/team-requests"

type Mine = TeamRequestDoc & { state: TeamRequestState; rfqNumber: string | null; poNumber: string | null; promisedDate: string | null; preparedByName: string | null }

const TONE: Record<TeamRequestState, PillTone> = { sent: "module", rfq: "violet", order: "info", on_way: "info", received: "ok", declined: "bad", withdrawn: "mute" }

export function MyTeamRequests({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { toast } = useToast()
  const [rows, setRows] = useState<Mine[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // The signed-in user may arrive after the first render: the list loads once he does, never spins forever.
  const { user } = useUser()
  const load = useCallback(async () => {
    if (!user) return
    const token = await user.getIdToken().catch(() => "")
    const res = token ? await fetch("/api/procurement/team-requests", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null) : null
    const body = res && res.ok ? ((await res.json().catch(() => null)) as { data?: { requests?: Mine[] } } | null) : null
    setRows(body?.data?.requests || [])
  }, [user])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const withdraw = async (r: Mine) => {
    const user = getAuth().currentUser
    if (!user || !window.confirm(t("tr_withdraw_confirm", { number: displayNeedRef(r.number, locale) }))) return
    setBusy(r.id)
    try {
      const res = await fetch("/api/procurement/team-requests", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ action: "withdraw", id: r.id }) })
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (res.ok) toast({ title: t("tr_withdrawn") })
      else toast({ title: body?.code === "IN_RFQ" ? t("tr_withdraw_in_rfq") : t("tr_failed"), variant: "destructive" })
      await load()
    } catch {
      toast({ title: t("tr_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  if (rows == null)
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-card p-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} aria-label={t("tr_loading")} />
      </div>
    )
  if (!rows.length) return <EmptyState icon={ClipboardList} title={t("tr_mine_none")} description={t("tr_mine_none_hint")} />

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex flex-wrap items-center gap-2">
                <b className="text-base" dir="auto">
                  {displayNeedRef(r.number, locale)}
                </b>
                <span className="text-sm font-semibold" dir="auto">
                  {r.place.label}
                </span>
                <StatusPill tone={TONE[r.state]}>{t(`tr_state_${r.state}`)}</StatusPill>
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
                {r.lines.map((l, i) => (
                  <span key={i}>
                    {l.name} <b className="tabular-nums" dir="ltr">{l.quantity.toLocaleString("en-US")}</b> <span className="text-xs text-muted-foreground">{l.unit}</span>
                  </span>
                ))}
              </p>
              <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                <span>{t("rq_need_by", { date: fmtDayLong(r.needBy, locale, false) })}</span>
                {r.rfqNumber && <span>{t("tr_in_rfq", { number: r.rfqNumber })}</span>}
                {r.poNumber && <span>{t("tr_in_po", { number: displayPoNumber(r.poNumber, locale) })}</span>}
                {r.promisedDate && (r.state === "order" || r.state === "on_way") && <span>{t("tr_promised", { date: fmtDayLong(r.promisedDate, locale, false) })}</span>}
              </p>
              {r.state === "declined" && r.declinedReason && <p className="text-xs font-semibold text-destructive">{t("tr_declined_why", { name: r.declinedByName || "", reason: r.declinedReason })}</p>}
            </div>
            {r.state === "sent" && (
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void withdraw(r)} className="gap-1.5">
                {busy === r.id && <Loader2 size={13} className="animate-spin" />}
                {t("tr_withdraw")}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
