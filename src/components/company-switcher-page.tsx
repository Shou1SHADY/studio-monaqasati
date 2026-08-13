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
import { Building2, PlusCircle, CheckCircle2, Loader2, ArrowLeftRight } from "lucide-react"

type OrgMembership = {
  organizationId: string
  companyName: string
  isPrimary?: boolean
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
    orgMemberships?: OrgMembership[]
  } | null

  const isOwner = !typedProfile || !("organizationRole" in typedProfile) || typedProfile.organizationRole === "owner"
  const currentOrgId = typedProfile?.organizationId || user?.uid || ""

  const memberships: OrgMembership[] =
    typedProfile?.orgMemberships && typedProfile.orgMemberships.length > 0
      ? typedProfile.orgMemberships
      : user
        ? [{ organizationId: user.uid, companyName: typedProfile?.companyName || typedProfile?.name || t("company_switcher_default_name"), isPrimary: true }]
        : []

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCr, setNewCr] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const handleSwitch = async (organizationId: string) => {
    if (!firestore || !user || organizationId === currentOrgId) return
    setSwitchingId(organizationId)
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        organizationId,
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("company_switcher_switched") })
      // Every org-scoped listener across the app (team groups, projects, RFQs, ...)
      // needs to re-subscribe against the new organizationId. Re-rendering in place
      // races those listeners against the write's propagation, which can surface a
      // transient permission-denied error. A full reload guarantees a clean restart
      // strictly after the write above has already committed.
      window.location.reload()
    } catch (err) {
      console.error(err)
      toast({ title: t("company_switcher_error"), variant: "destructive" })
    } finally {
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
        createdAt: serverTimestamp(),
      })
      await updateDoc(doc(firestore, "users", user.uid), {
        orgMemberships: arrayUnion(
          ...(typedProfile?.orgMemberships && typedProfile.orgMemberships.length > 0
            ? []
            : [{ organizationId: user.uid, companyName: typedProfile?.companyName || typedProfile?.name || t("company_switcher_default_name"), isPrimary: true }]),
          { organizationId: orgRef.id, companyName: newName.trim(), isPrimary: false }
        ),
      })
      toast({ title: t("company_switcher_added") })
      setNewName("")
      setNewCr("")
      setShowAdd(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("company_switcher_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const isLoading = isUserLoading || profileLoading

  return (
    <PortalLayout>
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
              return (
                <Card key={m.organizationId} className={cn("border-2 transition-colors", isCurrent ? "border-primary/40 bg-primary/5" : "border-slate-200/70")}>
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0", isCurrent ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500")}>
                      <Building2 size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-800 truncate">{m.companyName}</p>
                        {m.isPrimary && <Badge variant="outline" className="text-[10px]">{t("company_switcher_primary_badge")}</Badge>}
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
                          onClick={() => handleSwitch(m.organizationId)}
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
            <div className="space-y-1.5">
              <Label htmlFor="company-name">{t("company_switcher_name_label")} *</Label>
              <Input id="company-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-cr">{t("company_switcher_cr_label")}</Label>
              <Input id="company-cr" value={newCr} onChange={(e) => setNewCr(e.target.value)} dir="ltr" />
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
