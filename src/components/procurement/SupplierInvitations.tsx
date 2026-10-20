"use client"

// «الدعوات» in Suppliers (Procurement 1.5, PUR-05): every invitation to the platform with
// its state — أُرسلت · فُتحت · انضم · انتهت (· أُلغيت · رفضها) — derived, never stored
// (`invitationState`): 30 days from when it was (last) sent. «أعد الإرسال» sends it again
// and restarts the 30 days; «ألغِ» stops its link; a supplier who joined is in «مورّدونا»
// and his file opens from here.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Loader2, Send } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { todayOf } from "@/lib/procurement/po"
import { invitationState, type InvitationState } from "@/lib/procurement/invitations"
import { fmtDayLong } from "@/lib/procurement/format"
import { label } from "@/lib/materials/tree"
import { displayCategory } from "@/lib/constants"
import type { InvitePrefill } from "./InviteSupplierDialog"

export interface InvitationDoc {
  id: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  message?: string | null
  category?: string | null
  specialtyIds?: string[] | null
  invitedBy?: string | null
  invitedByName?: string | null
  createdAt?: unknown
  renewedAt?: string | null
  openedAt?: string | null
  status?: string | null
  type?: string | null
  inviteToken?: string | null
  sentChannel?: "wa" | "email" | "sms" | null
  acceptedSupplierOrgId?: string | null
}

export const invitationDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v.slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? todayOf(ts.toDate()) : null
}

export const portalOrigin = () => (typeof window !== "undefined" && window.location.origin) || "https://mdmaktech.sa"

const TONE: Record<InvitationState, PillTone> = { sent: "info", opened: "violet", joined: "ok", expired: "mute", cancelled: "mute", declined: "bad" }

export function SupplierInvitations({
  invitations,
  canManage,
  now,
  onResend,
  onOpenSupplier,
}: {
  invitations: InvitationDoc[]
  canManage: boolean
  now: Date
  onResend: (prefill: InvitePrefill) => void
  onOpenSupplier?: (orgId: string) => void
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const { toast } = useToast()
  const { index } = useMaterialTree()
  const [busy, setBusy] = useState<string | null>(null)

  if (!invitations.length) return <EmptyState icon={Send} title={t("inv2.none")} description={t("inv2.none_hint")} />

  const sorted = [...invitations].sort((a, b) => (b.renewedAt || invitationDay(b.createdAt) || "").localeCompare(a.renewedAt || invitationDay(a.createdAt) || ""))
  const specs = (inv: InvitationDoc) => {
    const names = (inv.specialtyIds || []).map((id) => (index?.byId.get(id) ? label(index.byId.get(id)!, locale) : "")).filter(Boolean)
    if (names.length) return names.join(" · ")
    return inv.category ? displayCategory(inv.category, locale) : "—"
  }
  const cancel = async (inv: InvitationDoc) => {
    const user = getAuth().currentUser
    if (!user || !window.confirm(t("inv2.cancel_confirm", { name: inv.companyName || "" }))) return
    setBusy(inv.id)
    try {
      const res = await fetch("/api/invitations/cancel", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ invitationId: inv.id }) })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("inv2.cancelled") })
    } catch {
      toast({ title: t("err.generic"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-start font-semibold">{t("inv2.col_supplier")}</th>
            <th className="px-4 py-3 text-start font-semibold">{t("inv2.col_specialty")}</th>
            <th className="px-4 py-3 text-start font-semibold">{t("inv2.col_sent")}</th>
            <th className="px-4 py-3 text-start font-semibold">{t("inv2.col_state")}</th>
            <th className="px-4 py-3">
              <span className="sr-only">{t("inv2.col_actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((inv) => {
            const state = invitationState(inv, now)
            const day = inv.renewedAt?.slice(0, 10) || invitationDay(inv.createdAt)
            return (
              <tr key={inv.id} className="align-middle">
                <td className="px-4 py-3">
                  <p className="font-bold" dir="auto">
                    {inv.companyName || inv.email || inv.phone}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {inv.contactName || "—"} · <span dir="ltr">{inv.phone || inv.email || ""}</span>
                  </p>
                </td>
                <td className="px-4 py-3 text-xs" dir="auto">
                  {specs(inv)}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {day ? fmtDayLong(day, locale, false) : "—"}
                  {inv.sentChannel && <span className="block">{t(`inv2.ch_${inv.sentChannel}`)}</span>}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={TONE[state]}>{state === "joined" ? t("inv2.st_joined_ours") : t(`inv2.st_${state}`)}</StatusPill>
                </td>
                <td className="px-4 py-3 text-end">
                  <span className="inline-flex flex-wrap justify-end gap-1.5">
                    {state === "joined" && inv.acceptedSupplierOrgId && onOpenSupplier ? (
                      <Button size="sm" variant="outline" onClick={() => onOpenSupplier(inv.acceptedSupplierOrgId as string)}>
                        {t("inv2.open_file")}
                      </Button>
                    ) : canManage && (state === "sent" || state === "opened" || state === "expired" || state === "cancelled") ? (
                      <Button size="sm" variant="outline" onClick={() => onResend({ companyName: inv.companyName || "", contactName: inv.contactName || "", contact: inv.phone || inv.email || "", specialtyIds: inv.specialtyIds || [] })}>
                        {t("inv2.resend")}
                      </Button>
                    ) : null}
                    {canManage && (state === "sent" || state === "opened") && (
                      <Button size="sm" variant="ghost" disabled={busy === inv.id} onClick={() => void cancel(inv)}>
                        {busy === inv.id && <Loader2 size={13} className="me-1 animate-spin" />}
                        {t("inv2.cancel")}
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
