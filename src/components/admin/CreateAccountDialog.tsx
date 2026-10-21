"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, Loader2, ShoppingCart, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { LeadKind, LeadSource } from "@/lib/admin-crm"
import { MaterialSubsPicker } from "@/components/materials/MaterialSubsPicker"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { cn } from "@/lib/utils"

/** The lead an account is being created for — enough to prefill the form and to mark the lead converted. */
export type AccountLead = {
  id: string
  source: LeadSource
  name: string
  company: string
  email: string
  phone: string
  kind?: LeadKind
}

type Role = "Contractor" | "Supplier"

/**
 * Creates the Contractor / Supplier account for a lead (admin only — public sign-up is closed). The new user gets a
 * password-set link by e-mail; the lead is marked converted and its CRM file moves to the client. Used by the leads
 * inbox and by the lead's page in the CRM, so a lead is converted the same way wherever the team works it.
 */
export function CreateAccountDialog({
  lead,
  onOpenChange,
  onCreated,
}: {
  lead: AccountLead | null
  onOpenChange: (open: boolean) => void
  onCreated?: (uid: string) => void
}) {
  const t = useTranslations("Portal.Admin.Leads")
  const locale = useLocale()
  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("create_account_title")}</DialogTitle>
          <DialogDescription>{t("create_account_desc")}</DialogDescription>
        </DialogHeader>
        {lead && <AccountForm key={`${lead.source}:${lead.id}`} lead={lead} onClose={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function AccountForm({ lead, onClose, onCreated }: { lead: AccountLead; onClose: () => void; onCreated?: (uid: string) => void }) {
  const t = useTranslations("Portal.Admin.Leads")
  const { user } = useUser()
  const { toast } = useToast()
  const [role, setRole] = useState<Role>(lead.kind === "supplier" ? "Supplier" : "Contractor")
  const [name, setName] = useState(lead.company || lead.name)
  const [email, setEmail] = useState(lead.email)
  const [phone, setPhone] = useState(lead.phone.replace(/\D/g, ""))
  const { index } = useMaterialTree()
  const [specs, setSpecs] = useState<string[]>([])
  // Most suppliers only sell (11 Oct 2026): the account starts with Order Management, Sales and Governance only.
  const [salesOnly, setSalesOnly] = useState(true)
  const [busy, setBusy] = useState(false)

  const ready = name.trim() !== "" && email.trim() !== "" && (role === "Contractor" || specs.length > 0)

  const submit = async () => {
    if (!user || !ready) return
    setBusy(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          name,
          email,
          phone,
          role,
          specialtyIds: role === "Supplier" ? specs : undefined,
          salesOnly: role === "Supplier" ? salesOnly : undefined,
          leadId: lead.id,
          leadCollection: lead.source === "onboarding" ? "onboardingRequests" : "demoRequests",
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (data?.code === "EMAIL_IN_USE") toast({ title: t("email_in_use_title"), description: t("email_in_use_desc"), variant: "destructive" })
        else toast({ title: t("error"), description: t("error_generic"), variant: "destructive" })
        return
      }
      toast({ title: t("account_created_title"), description: t("account_created_desc") })
      onClose()
      onCreated?.(String(data.data?.uid ?? ""))
    } catch {
      toast({ title: t("error"), description: t("error_generic"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const roles: Array<{ value: Role; icon: typeof Building2; label: string }> = [
    { value: "Contractor", icon: Building2, label: t("contractor") },
    { value: "Supplier", icon: ShoppingCart, label: t("supplier") },
  ]

  return (
    <>
      <div className="space-y-5 py-2">
        <div className="space-y-3">
          <Label className="font-bold">{t("role")}</Label>
          <div role="radiogroup" aria-label={t("role")} className="grid grid-cols-2 gap-3">
            {roles.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={role === value}
                onClick={() => {
                  setRole(value)
                  setSpecs([])
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 bg-card p-4 text-sm font-bold transition-colors",
                  "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  role === value ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="acc-name" className="font-bold">{t("name")}</Label>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acc-email" className="font-bold">{t("email")}</Label>
          <Input id="acc-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acc-phone" className="font-bold">{t("phone")}</Label>
          <Input id="acc-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
        </div>

        {role === "Supplier" && (
          <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="acc-sales-only" className="font-bold">{t("sales_only")}</Label>
              <p className="text-xs text-muted-foreground">{t("sales_only_desc")}</p>
            </div>
            <Switch id="acc-sales-only" checked={salesOnly} onCheckedChange={setSalesOnly} disabled={busy} />
          </div>
        )}

        {role === "Supplier" && (
          <div className="space-y-2">
            <Label className="font-bold">{t("specializations")}</Label>
            <MaterialSubsPicker index={index} value={specs} onChange={setSpecs} disabled={busy} />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !ready} className="gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
          {t("create_account")}
        </Button>
      </DialogFooter>
    </>
  )
}
