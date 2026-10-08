"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Handshake, Inbox, Loader2, Plus, UserPlus, CheckCircle2 } from "lucide-react"
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection } from "firebase/firestore"
import { useTranslations, useLocale } from "next-intl"
import { Link } from "@/i18n/routing"
import { AddLeadDialog } from "@/components/admin/AddLeadDialog"
import { CreateAccountDialog, type AccountLead } from "@/components/admin/CreateAccountDialog"
import { leadKind, type LeadSource } from "@/lib/admin-crm"
import { isAllCompanyTypes, leadCompanyTypes, type CompanyType } from "@/lib/company-types"
import { cn } from "@/lib/utils"

type Lead = {
  id: string
  source: LeadSource
  name: string
  company: string
  phone: string
  email: string
  status: string
  createdAt: any
  preferredDate: string
  city: string
  size: string
  types: CompanyType[]
  typeOther: string
}

const KIND_STYLE: Record<LeadSource, string> = {
  demo: "bg-cta/10 text-cta border-cta/20",
  onboarding: "bg-success/10 text-success border-success/20",
  manual: "bg-muted text-muted-foreground border-border",
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

  const detailLines = (lead: Lead): string[] => {
    const sep = locale === "ar" ? "، " : ", "
    const typeParts = [...(isAllCompanyTypes(lead.types) ? [t("type_all")] : lead.types.map((x) => t(`type_${x}`))), ...(lead.typeOther ? [lead.typeOther] : [])]
    const lines: string[] = []
    if (lead.source === "demo" && lead.preferredDate) lines.push(t("demo_on", { date: lead.preferredDate }))
    const place = [lead.city, lead.size].filter(Boolean).join(sep)
    if (lead.source === "onboarding" && place) lines.push(place)
    if (typeParts.length) lines.push(typeParts.join(sep))
    return lines.length ? lines : ["—"]
  }

  useEffect(() => {
    const removed = new Set([
      ...(demoRequests || []).filter((d: { archived?: boolean }) => d.archived === true).map((d: { id: string }) => `d:${d.id}`),
      ...(onboardingRequests || []).filter((d: { archived?: boolean }) => d.archived === true).map((d: { id: string }) => `o:${d.id}`),
    ])
    const demo: Lead[] = (demoRequests || []).map((d: any) => ({
      id: d.id,
      source: d.origin === "manual" ? "manual" : "demo",
      name: d.name || "",
      company: d.company || "",
      phone: d.phone || "",
      email: d.email || "",
      status: d.status || "new",
      createdAt: d.createdAt,
      preferredDate: d.preferredDate || "",
      city: "",
      size: "",
      types: leadCompanyTypes(d).types,
      typeOther: leadCompanyTypes(d).other,
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
      preferredDate: "",
      city: d.city || "",
      size: d.size || "",
      types: leadCompanyTypes(d).types,
      typeOther: leadCompanyTypes(d).other,
    }))
    const received = (l: Lead) => getTs(l.createdAt) || (l.source === "manual" ? Date.now() : 0)
    // A lead removed in the CRM (junk, a duplicate) stays out of this list too.
    const live = (l: Lead) => !removed.has(`${l.source === "onboarding" ? "o" : "d"}:${l.id}`)
    setLocalLeads([...demo, ...onboarding].filter(live).sort((a, b) => received(b) - received(a)))
  }, [demoRequests, onboardingRequests])

  const [addOpen, setAddOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const accountLead: AccountLead | null = selectedLead && {
    id: selectedLead.id,
    source: selectedLead.source,
    name: selectedLead.name,
    company: selectedLead.company,
    email: selectedLead.email,
    phone: selectedLead.phone,
    kind: leadKind(selectedLead.types),
  }
  const markConverted = (id: string) => setLocalLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: "converted" } : l)))

  const isLoading = demoLoading || onboardingLoading

  return (
    <PortalLayout>
      <div className="space-y-6 text-start">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild className="gap-1.5">
              <Link href="/admin/crm?tab=leads">
                <Handshake size={15} aria-hidden="true" />
                {t("open_in_crm")}
              </Link>
            </Button>
            <Button onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus size={15} aria-hidden="true" />
              {t("add_lead")}
            </Button>
          </div>
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
                    <TableHead className="text-start">{t("name")}</TableHead>
                    <TableHead className="text-start hidden sm:table-cell">{t("company")}</TableHead>
                    <TableHead className="text-start hidden md:table-cell">{t("email")}</TableHead>
                    <TableHead className="text-start hidden md:table-cell">{t("phone")}</TableHead>
                    <TableHead className="text-start">{t("col_request")}</TableHead>
                    <TableHead className="text-start hidden lg:table-cell">{t("col_details")}</TableHead>
                    <TableHead className="text-start hidden sm:table-cell">{t("col_received")}</TableHead>
                    <TableHead className="text-start">{t("status")}</TableHead>
                    <TableHead className="text-end">{t("actions")}</TableHead>
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
                        <Badge variant="outline" className={cn("text-xs", KIND_STYLE[lead.source])}>
                          {t(`source_${lead.source}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {detailLines(lead).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground tabular-nums" dir="ltr">
                        {getTs(lead.createdAt) ? new Date(getTs(lead.createdAt)).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB") : "—"}
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
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          disabled={lead.status === "converted"}
                          onClick={() => setSelectedLead(lead)}
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

        <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} ownerName={user?.displayName || user?.email || ""} />

        <CreateAccountDialog lead={accountLead} onOpenChange={(o) => !o && setSelectedLead(null)} onCreated={() => selectedLead && markConverted(selectedLead.id)} />
      </div>
    </PortalLayout>
  )
}
