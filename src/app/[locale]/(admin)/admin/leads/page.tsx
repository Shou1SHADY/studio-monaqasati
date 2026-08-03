"use client"

import { useState, useEffect, useRef } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Inbox, Loader2, UserPlus, Building2, ShoppingCart, ChevronDown, Check, Search, X, CheckCircle2 } from "lucide-react"
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from "next-intl"
import { PREDEFINED_CATEGORIES, displayCategory } from "@/lib/constants"

type Lead = {
  id: string
  source: "demo" | "onboarding"
  name: string
  company: string
  phone: string
  email: string
  status: string
  createdAt: any
}

function getTs(ts: any): number {
  if (!ts) return 0
  if (ts?.seconds) return ts.seconds * 1000
  if (ts?.toDate) return ts.toDate().getTime()
  return new Date(ts).getTime()
}

export default function AdminLeadsPage() {
  const t = useTranslations("Portal.Admin.Leads")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const demoQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return collection(firestore, "demoRequests")
  }, [firestore, user, isUserLoading])

  const onboardingQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return collection(firestore, "onboardingRequests")
  }, [firestore, user, isUserLoading])

  const { data: demoRequests, isLoading: demoLoading } = useCollection(demoQuery)
  const { data: onboardingRequests, isLoading: onboardingLoading } = useCollection(onboardingQuery)

  const [localLeads, setLocalLeads] = useState<Lead[]>([])

  useEffect(() => {
    const demo: Lead[] = (demoRequests || []).map((d: any) => ({
      id: d.id,
      source: "demo",
      name: d.name || "",
      company: d.company || "",
      phone: d.phone || "",
      email: d.email || "",
      status: d.status || "new",
      createdAt: d.createdAt,
    }))
    const onboarding: Lead[] = (onboardingRequests || []).map((d: any) => ({
      id: d.id,
      source: "onboarding",
      name: d.name || "",
      company: d.company || "",
      phone: d.phone || "",
      email: d.email || "",
      status: d.status || "new",
      createdAt: d.createdAt,
    }))
    setLocalLeads([...demo, ...onboarding].sort((a, b) => getTs(b.createdAt) - getTs(a.createdAt)))
  }, [demoRequests, onboardingRequests])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "Contractor" as "Contractor" | "Supplier",
    specializations: [] as string[],
  })

  const [specDropdownOpen, setSpecDropdownOpen] = useState(false)
  const [specSearch, setSpecSearch] = useState("")
  const specDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (specDropdownRef.current && !specDropdownRef.current.contains(e.target as Node)) {
        setSpecDropdownOpen(false)
        setSpecSearch("")
      }
    }
    if (specDropdownOpen) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [specDropdownOpen])

  const toggleSpec = (spec: string) => {
    setFormData(prev => ({
      ...prev,
      specializations: prev.specializations.includes(spec)
        ? prev.specializations.filter(s => s !== spec)
        : [...prev.specializations, spec],
    }))
  }

  const openCreateDialog = (lead: Lead) => {
    setSelectedLead(lead)
    setFormData({ name: lead.company || lead.name, email: lead.email, phone: lead.phone, role: "Contractor", specializations: [] })
    setDialogOpen(true)
  }

  const handleCreateAccount = async () => {
    if (!user || !selectedLead) return
    setIsSubmitting(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          role: formData.role,
          specializations: formData.role === "Supplier" ? formData.specializations : undefined,
          leadId: selectedLead.id,
          leadCollection: selectedLead.source === "demo" ? "demoRequests" : "onboardingRequests",
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (data?.code === "EMAIL_IN_USE") {
          toast({ title: t("email_in_use_title"), description: t("email_in_use_desc"), variant: "destructive" })
        } else {
          toast({ title: t("error"), description: data?.message || t("error_generic"), variant: "destructive" })
        }
        return
      }
      setLocalLeads(prev => prev.map(l => (l.id === selectedLead.id ? { ...l, status: "converted" } : l)))
      toast({ title: t("account_created_title"), description: t("account_created_desc") })
      setDialogOpen(false)
    } catch (err: any) {
      toast({ title: t("error"), description: err.message, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = demoLoading || onboardingLoading

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("page_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">{t("leads_list")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            ) : localLeads.length === 0 ? (
              <div className="p-16 text-center text-muted-foreground">
                <Inbox className="mx-auto h-12 w-12 opacity-20 mb-3" />
                <p className="font-medium">{t("no_leads_found")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right">{t("name")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("company")}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t("email")}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t("phone")}</TableHead>
                    <TableHead className="text-right">{t("source")}</TableHead>
                    <TableHead className="text-right">{t("status")}</TableHead>
                    <TableHead className="text-left">{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localLeads.map(lead => (
                    <TableRow key={`${lead.source}-${lead.id}`} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-bold">{lead.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{lead.company || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground" dir="ltr">{lead.email}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground" dir="ltr">{lead.phone || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {lead.source === "demo" ? t("source_demo") : t("source_onboarding")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {lead.status === "converted" ? (
                          <Badge className="bg-success/10 text-success border-success/20 gap-1">
                            <CheckCircle2 size={12} /> {t("status_converted")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t("status_new")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-left">
                        <Button
                          size="sm"
                          disabled={lead.status === "converted"}
                          onClick={() => openCreateDialog(lead)}
                          className="gap-1.5"
                        >
                          <UserPlus size={14} />
                          {t("create_account")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
            <DialogHeader>
              <DialogTitle>{t("create_account_title")}</DialogTitle>
              <DialogDescription>{t("create_account_desc")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              <div className="space-y-3">
                <Label className="font-bold">{t("role")}</Label>
                <RadioGroup
                  value={formData.role}
                  onValueChange={(v) => setFormData({ ...formData, role: v as "Contractor" | "Supplier", specializations: [] })}
                  className="grid grid-cols-2 gap-3"
                >
                  <div>
                    <RadioGroupItem value="Contractor" id="lead-contractor" className="peer sr-only" />
                    <Label
                      htmlFor="lead-contractor"
                      className="flex flex-col items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 hover:bg-slate-50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
                    >
                      <Building2 className="mb-2 h-6 w-6 text-primary" />
                      <span className="font-bold text-sm">{t("contractor")}</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="Supplier" id="lead-supplier" className="peer sr-only" />
                    <Label
                      htmlFor="lead-supplier"
                      className="flex flex-col items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 hover:bg-slate-50 peer-data-[state=checked]:border-success peer-data-[state=checked]:bg-success/5 cursor-pointer transition-all"
                    >
                      <ShoppingCart className="mb-2 h-6 w-6 text-success" />
                      <span className="font-bold text-sm">{t("supplier")}</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-name" className="font-bold">{t("name")}</Label>
                <Input id="lead-name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-email" className="font-bold">{t("email")}</Label>
                <Input
                  id="lead-email"
                  type="email"
                  dir="ltr"
                  className="text-left"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-phone" className="font-bold">{t("phone")}</Label>
                <Input
                  id="lead-phone"
                  type="tel"
                  dir="ltr"
                  className="text-left"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, "") })}
                />
              </div>

              {formData.role === "Supplier" && (
                <div className="space-y-2">
                  <Label className="font-bold">{t("specializations")}</Label>
                  <div className="relative" ref={specDropdownRef}>
                    <button
                      type="button"
                      onClick={() => { setSpecDropdownOpen(prev => !prev); setSpecSearch("") }}
                      className={`w-full flex items-center justify-between h-11 px-4 rounded-xl border-2 bg-slate-50 text-start transition-colors ${formData.specializations.length === 0 ? "border-slate-200 text-slate-400" : "border-primary/40 text-slate-800"
                        } hover:border-primary/60`}
                    >
                      <span className="text-sm truncate">
                        {formData.specializations.length === 0
                          ? t("select_specializations")
                          : t("selected_specializations", { count: formData.specializations.length })}
                      </span>
                      <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${specDropdownOpen ? "rotate-180" : ""}`} />
                    </button>

                    {specDropdownOpen && (
                      <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                        <div className="px-3 pt-3 pb-2">
                          <div className="relative">
                            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <Input
                              autoFocus
                              value={specSearch}
                              onChange={e => setSpecSearch(e.target.value)}
                              placeholder={t("search_specializations")}
                              className="h-9 pl-3 pr-9 text-sm rounded-lg bg-slate-100 border-slate-200"
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                          {PREDEFINED_CATEGORIES.filter(cat => {
                            if (!specSearch.trim()) return true
                            return displayCategory(cat, locale).toLowerCase().includes(specSearch.toLowerCase().trim())
                          }).map(cat => {
                            const isSelected = formData.specializations.includes(cat)
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => toggleSpec(cat)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right hover:bg-primary/5 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                              >
                                <div className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-primary border-primary" : "border-slate-300 bg-white"}`}>
                                  {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                                </div>
                                <span className={isSelected ? "font-bold text-primary" : "text-slate-700"}>{displayCategory(cat, locale)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {formData.specializations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {formData.specializations.map(spec => (
                        <span key={spec} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold px-2.5 py-1 rounded-full">
                          {displayCategory(spec, locale)}
                          <button type="button" onClick={() => toggleSpec(spec)} className="hover:text-destructive transition-colors">
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                {t("cancel")}
              </Button>
              <Button
                onClick={handleCreateAccount}
                disabled={isSubmitting || !formData.name || !formData.email || (formData.role === "Supplier" && formData.specializations.length === 0)}
                className="gap-2"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {t("create_account")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PortalLayout>
  )
}
