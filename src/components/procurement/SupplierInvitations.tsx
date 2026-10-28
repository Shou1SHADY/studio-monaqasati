"use client"

// «الدعوات» in Suppliers (Procurement 1.5, PUR-05): every invitation to the platform with
// its state — أُرسلت · فُتحت · انضم · انتهت (· أُلغيت · رفضها) — derived, never stored
// (`invitationState`): 30 days from when it was (last) sent. «أعد الإرسال» sends it again
// and restarts the 30 days; «ألغِ» stops its link; a supplier who joined is in «مورّدونا»
// and his file opens from here.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Loader2, Send } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
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

export const portalOrigin = () => (typeof window !== "undefined" && window.location.origin) || "https://mdmak.sa"

const TONE: Record<InvitationState, PillTone> = { sent: "info", opened: "violet", joined: "ok", expired: "mute", cancelled: "mute", declined: "bad" }

const FILTERS = ["all", "sent", "opened", "joined", "expired"] as const
type InvitationFilter = (typeof FILTERS)[number]

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
  const [filter, setFilter] = useState<InvitationFilter>("all")

  const sorted = useMemo(
    () => [...invitations].sort((a, b) => (b.renewedAt || invitationDay(b.createdAt) || "").localeCompare(a.renewedAt || invitationDay(a.createdAt) || "")),
    [invitations]
  )
  const stateOf = useMemo(() => new Map(sorted.map((inv) => [inv.id, invitationState(inv, now)])), [sorted, now])
  const counts = useMemo(() => {
    const out: Record<InvitationFilter, number> = { all: sorted.length, sent: 0, opened: 0, joined: 0, expired: 0 }
    for (const st of stateOf.values()) if (st in out) out[st as InvitationFilter]++
    return out
  }, [sorted, stateOf])
  const shown = filter === "all" ? sorted : sorted.filter((inv) => stateOf.get(inv.id) === filter)

  if (!invitations.length) return <EmptyState icon={Send} title={t("inv2.none")} description={t("inv2.none_hint")} />

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

  const columns: DataColumn<InvitationDoc>[] = [
    {
      key: "supplier",
      header: t("inv2.col_supplier"),
      cell: (inv) => (
        <>
          <p className="font-bold" dir="auto">
            {inv.companyName || inv.email || inv.phone}
          </p>
          <p className="text-xs font-normal text-muted-foreground">
            {inv.contactName || "—"} · <span dir="ltr">{inv.phone || inv.email || ""}</span>
          </p>
        </>
      ),
    },
    { key: "specialty", header: t("inv2.col_specialty"), cell: (inv) => <span className="text-xs" dir="auto">{specs(inv)}</span> },
    {
      key: "sent",
      header: t("inv2.col_sent"),
      cell: (inv) => {
        const day = inv.renewedAt?.slice(0, 10) || invitationDay(inv.createdAt)
        return (
          <span className="text-xs text-muted-foreground">
            {day ? fmtDayLong(day, locale, false) : "—"}
            {inv.sentChannel && <span className="block">{t(`inv2.ch_${inv.sentChannel}`)}</span>}
          </span>
        )
      },
    },
    {
      key: "state",
      header: t("inv2.col_state"),
      cell: (inv) => {
        const state = stateOf.get(inv.id) as InvitationState
        return <StatusPill tone={TONE[state]}>{state === "joined" ? t("inv2.st_joined_ours") : t(`inv2.st_${state}`)}</StatusPill>
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("inv2.col_actions")}</span>,
      label: t("inv2.col_actions"),
      cell: (inv) => {
        const state = stateOf.get(inv.id) as InvitationState
        return (
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
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("inv2.col_state")}>
        {FILTERS.map((f) => (
          <Chip key={f} selected={filter === f} count={counts[f]} onClick={() => setFilter(f)}>
            {t(f === "all" ? "inv2.f_all" : f === "joined" ? "inv2.st_joined" : `inv2.st_${f}`)}
          </Chip>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(inv) => inv.id}
        caption={t("seg.invitations")}
        labels={{ sortBy: (c) => c, showMore: (n) => t("list.show_more", { count: n }) }}
        pageSize={24}
        empty={<EmptyState icon={Send} title={t("inv2.none")} description={t("inv2.none_hint")} />}
      />
    </div>
  )
}
