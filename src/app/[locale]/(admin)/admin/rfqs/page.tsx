"use client"

import { useState, useEffect } from "react"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { displayCategory, displaySubcategory } from "@/lib/constants"
import {
  FileText,
  Search,
  Filter,
  Calendar,
  MoreVertical,
  Activity,
  CheckCircle,
  Clock,
  Loader2,
  Eye,
  Handshake,
} from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, orderBy, where } from "firebase/firestore"
import { useSearchParams } from "next/navigation"
import { useTranslations, useLocale } from 'next-intl'
import { Link } from "@/i18n/routing"
import { MDMAK_CONTRACTOR_ID } from "@/lib/mdmak-contractor"
import { CreateMdmakRfqDialog } from "@/components/admin/CreateMdmakRfqDialog"

export default function AdminRfqsPage() {
  const t = useTranslations("Portal.Admin.Rfqs")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [mdmakDialogOpen, setMdmakDialogOpen] = useState(false)
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), orderBy("createdAt", "desc"))
  }, [firestore, user, isUserLoading])

  const contractorsQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Contractor"))
  }, [firestore])

  const { data: rfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const { data: contractors } = useCollection(contractorsQuery)

  const contractorsMap = contractors?.reduce((acc: Record<string, string>, c: any) => {
    acc[c.id] = c.name || ""
    return acc
  }, {}) ?? {}
  const isLoading = isUserLoading || isCollectionLoading

  const filteredRfqs = rfqs?.filter((rfq: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const contractorName = contractorsMap[rfq.contractorId] || ""
    return (
      rfq.title?.toLowerCase().includes(q) ||
      rfq.category?.toLowerCase().includes(q) ||
      rfq.subCategory?.toLowerCase().includes(q) ||
      rfq.id?.toLowerCase().includes(q) ||
      contractorName.toLowerCase().includes(q)
    );
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "New": return <Badge className="bg-success/10 text-success border-success/20">{t("status_new")}</Badge>
      case "Awarded": return <Badge className="bg-blue-50 text-blue-600">{t("status_awarded")}</Badge>
      case "Completed": return <Badge className="bg-slate-50 text-slate-600">{t("status_completed")}</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder={t("search_placeholder")} 
                className="pr-10" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              {t("filter")}
            </Button>
            <Button onClick={() => setMdmakDialogOpen(true)} className="gap-2 bg-accent hover:bg-accent/90 text-primary font-bold shadow-lg shadow-accent/25 shrink-0">
              <Handshake size={16} />
              {t("post_as_mdmak_btn")}
            </Button>
          </div>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              {t("all_requests")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("loading_data")}</p>
              </div>
            ) : filteredRfqs.length === 0 ? (
              <div className="p-20 text-center text-muted-foreground">{t("no_tenders_current")}</div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right hidden md:table-cell">{t("id_col")}</TableHead>
                    <TableHead className="text-right">{t("tender")}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t("contractor")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("category")}</TableHead>
                    <TableHead className="text-right">{t("status")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("date")}</TableHead>
                    <TableHead className="text-left">{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRfqs.map((rfq: any) => (
                    <TableRow key={rfq.id}>
                      <TableCell className="font-mono text-xs hidden md:table-cell">{rfq.id}</TableCell>
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          <span>{rfq.title}</span>
                          {rfq.orderedFromMdmakDirect && (
                            <Badge className="text-[10px] bg-accent text-primary border-none shrink-0 gap-1">
                              <Handshake size={10} />
                              {t("direct_order_badge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {rfq.contractorId === MDMAK_CONTRACTOR_ID ? (
                          <Badge className="bg-accent/10 text-accent border-accent/20 gap-1">
                            <Handshake size={11} />
                            {t("contractor_mdmak_badge")}
                          </Badge>
                        ) : (
                          contractorsMap[rfq.contractorId] || "-"
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold">{displayCategory(rfq.category, locale)}</span>
                          <span className="text-[10px] text-muted-foreground">{displaySubcategory(rfq.subCategory, locale)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={14} />
                          {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US') : '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-left">
                        <Link href={`/admin/rfqs/${rfq.id}`}>
                          <Button variant="ghost" size="icon">
                            <Eye size={18} />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateMdmakRfqDialog open={mdmakDialogOpen} onClose={() => setMdmakDialogOpen(false)} />
    </PortalLayout>
  )
}