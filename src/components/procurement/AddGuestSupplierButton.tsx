"use client"

// «أضِفه إلى موردينا» for a supplier who has no account (SUP-03). The supplier is named by the offer (or the order on it) he
// quoted through a visitor link — never by a typed name — and the record is keyed by the mobile a code proved there. Used in
// his file, on the offer in the comparison and in the order's panel.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"

const REASONS = ["phone_not_verified", "not_a_guest", "not_found", "no_permission"] as const

export function AddGuestSupplierButton({
  target,
  size = "default",
  variant = "default",
  onAdded,
}: {
  target: { offerId?: string; poId?: string }
  size?: "default" | "sm"
  variant?: "default" | "outline"
  onAdded?: (supplierOrgId: string) => void
}) {
  const t = useTranslations("Portal.ProcSuppliers.file2")
  const { toast } = useToast()
  const { user } = useUser()
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!user) return
    setBusy(true)
    try {
      const res = await fetch("/api/procurement/suppliers/add-guest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(target) })
      const json = (await res.json().catch(() => ({}))) as { data?: { supplierOrgId: string; created: boolean }; code?: string }
      if (res.ok && json.data) {
        toast({ title: json.data.created ? t("added") : t("already") })
        onAdded?.(json.data.supplierOrgId)
        return
      }
      const reason = REASONS.find((r) => r.toUpperCase() === json.code)
      toast({ title: reason ? t(`err_${reason}`) : t("err_generic"), variant: "destructive" })
    } catch {
      toast({ title: t("err_generic"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size={size} variant={variant} className="gap-1.5" onClick={add} disabled={busy || !user}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
      {t("add")}
    </Button>
  )
}
