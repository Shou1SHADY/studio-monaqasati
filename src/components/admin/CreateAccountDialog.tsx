"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, Check, ChevronDown, Loader2, Search, ShoppingCart, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { LeadKind, LeadSource } from "@/lib/admin-crm"
import { PREDEFINED_CATEGORIES, displayCategory } from "@/lib/constants"
import { matchesSearch } from "@/lib/search-text"
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
  const locale = useLocale()
  const { user } = useUser()
  const { toast } = useToast()
  const [role, setRole] = useState<Role>(lead.kind === "supplier" ? "Supplier" : "Contractor")
  const [name, setName] = useState(lead.company || lead.name)
  const [email, setEmail] = useState(lead.email)
  const [phone, setPhone] = useState(lead.phone.replace(/\D/g, ""))
  const [specs, setSpecs] = useState<string[]>([])
  const [specOpen, setSpecOpen] = useState(false)
  const [specSearch, setSpecSearch] = useState("")
  const [busy, setBusy] = useState(false)

  const toggleSpec = (spec: string) => setSpecs((s) => (s.includes(spec) ? s.filter((x) => x !== spec) : [...s, spec]))
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
          specializations: role === "Supplier" ? specs : undefined,
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
  const shown = PREDEFINED_CATEGORIES.filter((cat) => !specSearch.trim() || matchesSearch(specSearch, [displayCategory(cat, locale), cat]))

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
          <div className="space-y-2">
            <Label className="font-bold">{t("specializations")}</Label>
            <Popover
              open={specOpen}
              onOpenChange={(o) => {
                setSpecOpen(o)
                if (!o) setSpecSearch("")
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-start text-sm transition-colors",
                    "hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    specs.length ? "border-primary/40 text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className="truncate">{specs.length ? t("selected_specializations", { count: specs.length }) : t("select_specializations")}</span>
                  <ChevronDown size={16} className={cn("shrink-0 transition-transform", specOpen && "rotate-180")} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                <div className="relative p-2">
                  <Search size={14} className="absolute start-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input autoFocus value={specSearch} onChange={(e) => setSpecSearch(e.target.value)} placeholder={t("search_specializations")} aria-label={t("search_specializations")} className="h-9 ps-8 text-sm" />
                </div>
                <div className="max-h-56 divide-y overflow-y-auto border-t">
                  {shown.map((cat) => {
                    const on = specs.includes(cat)
                    return (
                      <button
                        key={cat}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleSpec(cat)}
                        className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none", on && "bg-primary/5")}
                      >
                        <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background")}>
                          {on && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                        </span>
                        <span className={on ? "font-bold text-primary" : undefined}>{displayCategory(cat, locale)}</span>
                      </button>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
            {specs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {specs.map((spec) => (
                  <span key={spec} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pe-1 ps-2.5 text-xs font-bold text-primary">
                    {displayCategory(spec, locale)}
                    <button type="button" aria-label={t("remove_specialization", { name: displayCategory(spec, locale) })} onClick={() => toggleSpec(spec)} className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
