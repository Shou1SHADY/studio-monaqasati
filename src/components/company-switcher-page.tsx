"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFirestore, useUser, useDoc, useMemoFirebase } from "@/firebase"
import { doc, addDoc, collection, updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import type { OrgMembership } from "@/hooks/useActiveCompanyName"
import { CompanySwitchOverlay } from "@/components/layout/company-switch-overlay"
import {
  beginCompanySwitch,
  companyPortalPath,
  endCompanySwitch,
  switchActiveCompany,
  switchErrorCode,
  type CompanyRole,
} from "@/lib/company-switch"
import { Building2, PlusCircle, CheckCircle2, Loader2, ArrowLeftRight, HardHat, Truck } from "lucide-react"

export function RoleBadge({ role, t }: { role: CompanyRole; t: ReturnType<typeof useTranslations<"Portal.Shared">> }) {
  const isSupplier = role === "Supplier"
  const Icon = isSupplier ? Truck : HardHat
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] gap-1 font-semibold",
        isSupplier ? "text-accent border-accent/30 bg-accent/5" : "text-cta border-cta/30 bg-cta/5"
      )}
    >
      <Icon size={10} />
      {isSupplier ? t("company_role_supplier") : t("company_role_contractor")}
    </Badge>
  )
}

export function CompanySwitcherPage() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user])
  const { data: profile, isLoading: profileLoading } = useDoc(userDocRef)
  const typedProfile = profile as {
    organizationId?: string
    organizationRole?: string
    companyName?: string
    name?: string
    role?: CompanyRole
    primaryRole?: CompanyRole
    orgMemberships?: OrgMembership[]
  } | null

  const isOwner = !typedProfile || !("organizationRole" in typedProfile) || typedProfile.organizationRole === "owner"
  const currentOrgId = typedProfile?.organizationId || user?.uid || ""
  // The role the account was created with — what the primary company operates as,
  // and the fallback for legacy memberships that predate cross-role companies.
  const baseRole: CompanyRole = typedProfile?.primaryRole || typedProfile?.role || "Contractor"

  const memberships: OrgMembership[] =
    typedProfile?.orgMemberships && typedProfile.orgMemberships.length > 0
      ? typedProfile.orgMemberships
      : user
        ? [{ organizationId: user.uid, companyName: typedProfile?.companyName || typedProfile?.name || t("company_switcher_default_name"), isPrimary: true, role: baseRole }]
        : []

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCr, setNewCr] = useState("")
  const [newRole, setNewRole] = useState<CompanyRole>(baseRole)
  const [isSaving, setIsSaving] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const membershipRole = (m: OrgMembership): CompanyRole =>
    m.isPrimary || m.organizationId === user?.uid ? baseRole : (m.role || baseRole)

  const handleSwitch = async (m: OrgMembership) => {
    if (!firestore || !user || m.organizationId === currentOrgId) return
    setSwitchingId(m.organizationId)
    try {
      // Freezes everything that reacts to the profile until the navigation
      // below replaces the document — see the flag's note in lib/company-switch.
      beginCompanySwitch()
      const targetRole = await switchActiveCompany({
        firestore,
        uid: user.uid,
        membership: m,
        profile: typedProfile,
      })
      // No success toast: the document is replaced within the same beat, so it
      // would flash unread. The overlay below is what confirms the switch.
      // Every org-scoped listener across the app (team groups, projects, RFQs, ...)
      // needs to re-subscribe against the new organizationId — and the target
      // company may live in the OTHER portal entirely. A full navigation to the
      // target portal's root guarantees a clean restart strictly after the write
      // above has committed, landing on the correct contractor/supplier side.
      window.location.href = companyPortalPath(targetRole, locale)
    } catch (err) {
      endCompanySwitch()
      console.error(err)
      toast({
        title: t("company_switcher_error"),
        description: switchErrorCode(err),
        variant: "destructive",
      })
      setSwitchingId(null)
    }
  }

  const handleAddCompany = async () => {
    if (!firestore || !user || !newName.trim()) {
      toast({ title: t("company_switcher_name_required"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const orgRef = await addDoc(collection(firestore, "organizations"), {
        name: newName.trim(),
        crNumber: newCr.trim() || null,
        ownerUserId: user.uid,
        role: newRole,
        createdAt: serverTimestamp(),
      })
      await updateDoc(doc(firestore, "users", user.uid), {
        // Anchor the account's original role once, so switching back to the
        // primary company can always restore it (enforced by Firestore rules).
        primaryRole: baseRole,
        orgMemberships: arrayUnion(
          ...(typedProfile?.orgMemberships && typedProfile.orgMemberships.length > 0
            ? []
            : [{ organizationId: user.uid, companyName: typedProfile?.companyName || typedProfile?.name || t("company_switcher_default_name"), isPrimary: true, role: baseRole }]),
          { organizationId: orgRef.id, companyName: newName.trim(), isPrimary: false, role: newRole }
        ),
      })
      toast({ title: t("company_switcher_added") })
      setNewName("")
      setNewCr("")
      setNewRole(baseRole)
      setShowAdd(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("company_switcher_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const isLoading = isUserLoading || profileLoading

  const roleOptions: { value: CompanyRole; icon: typeof HardHat; title: string; desc: string }[] = [
    { value: "Contractor", icon: HardHat, title: t("company_role_contractor"), desc: t("company_role_contractor_desc") },
    { value: "Supplier", icon: Truck, title: t("company_role_supplier"), desc: t("company_role_supplier_desc") },
  ]

  return (
    <PortalLayout>
      {/* PortalLayout has its own overlay, but it is driven by the navbar
          switcher's state — this page switches through its own handler. */}
      <CompanySwitchOverlay show={!!switchingId} />
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("company_switcher_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("company_switcher_desc")}</p>
          </div>
          {isOwner && (
            <Button className="gap-1.5" onClick={() => setShowAdd(true)}>
              <PlusCircle size={16} />
              {t("company_switcher_add_btn")}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
          </div>
        ) : !isOwner ? (
          <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
            <Building2 size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">{t("company_switcher_not_owner")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {memberships.map((m) => {
              const isCurrent = m.organizationId === currentOrgId
              const role = membershipRole(m)
              return (
                <Card key={m.organizationId} className={cn("border-2 transition-colors", isCurrent ? "border-primary/40 bg-primary/5" : "border-slate-200/70")}>
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0", isCurrent ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500")}>
                      {role === "Supplier" ? <Truck size={22} /> : <HardHat size={22} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-800 truncate">{m.companyName}</p>
                        {m.isPrimary && <Badge variant="outline" className="text-[10px]">{t("company_switcher_primary_badge")}</Badge>}
                        <RoleBadge role={role} t={t} />
                      </div>
                      {isCurrent ? (
                        <p className="text-xs text-primary font-semibold flex items-center gap-1 mt-1">
                          <CheckCircle2 size={12} />
                          {t("company_switcher_current")}
                        </p>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs mt-2"
                          onClick={() => handleSwitch(m)}
                          disabled={switchingId === m.organizationId}
                        >
                          {switchingId === m.organizationId ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftRight size={12} />}
                          {t("company_switcher_switch_btn")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={(open) => { if (!isSaving) setShowAdd(open) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{t("company_switcher_add_title")}</DialogTitle>
            <DialogDescription>{t("company_switcher_add_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("company_role_label")} *</Label>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("company_role_label")}>
                {roleOptions.map(({ value, icon: Icon, title, desc }) => {
                  const selected = newRole === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setNewRole(value)}
                      disabled={isSaving}
                      className={cn(
                        "text-start p-3.5 rounded-xl border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        selected
                          ? "border-primary/50 bg-primary/5 shadow-sm"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      )}
                    >
                      <div className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center mb-2",
                        selected ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500"
                      )}>
                        <Icon size={18} />
                      </div>
                      <p className={cn("text-sm font-bold", selected ? "text-primary" : "text-slate-700")}>{title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-name">{t("company_switcher_name_label")} *</Label>
              <Input id="company-name" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-cr">{t("company_switcher_cr_label")}</Label>
              <Input id="company-cr" value={newCr} onChange={(e) => setNewCr(e.target.value)} dir="ltr" disabled={isSaving} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={isSaving}>{t("cancel")}</Button>
            <Button onClick={handleAddCompany} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("company_switcher_add_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}
