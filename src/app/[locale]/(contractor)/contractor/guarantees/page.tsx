"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  Calendar,
  Building2,
  FileText,
  ExternalLink,
  Package,
  ArrowRight,
} from "lucide-react"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type Guarantee = {
  id: string
  rfqTitle?: string
  supplierName?: string
  itemName?: string
  itemNameEn?: string
  fileUrl?: string
  fileType?: string
  expirationDate?: string
  status?: "pending_review" | "accepted" | "rejected"
  createdAt?: unknown
  rfqId?: string
}

function statusBadge(status: string | undefined, t: ReturnType<typeof useTranslations<"Portal.Contractor">>) {
  if (status === "accepted") {
    return (
      <Badge className="bg-success/10 text-success border-success/20 text-xs font-bold w-fit gap-1">
        <ShieldCheck size={12} />
        {t("guarantees_status_accepted")}
      </Badge>
    )
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-xs font-bold w-fit gap-1">
        <ShieldX size={12} />
        {t("guarantees_status_rejected")}
      </Badge>
    )
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs font-bold w-fit gap-1">
      <ShieldQuestion size={12} />
      {t("guarantees_status_pending")}
    </Badge>
  )
}

function GuaranteeCard({ guarantee, locale, t }: { guarantee: Guarantee; locale: string; t: ReturnType<typeof useTranslations<"Portal.Contractor">> }) {
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [isUpdating, setIsUpdating] = useState(false)

  const isExpired = guarantee.expirationDate ? new Date(guarantee.expirationDate).getTime() < Date.now() : false

  const handleReview = async (nextStatus: "accepted" | "rejected") => {
    if (!firestore || !user) return
    setIsUpdating(true)
    try {
      await updateDoc(doc(firestore, "guarantees", guarantee.id), {
        status: nextStatus,
        reviewedAt: serverTimestamp(),
        reviewedByUserId: user.uid,
      })
      toast({ title: nextStatus === "accepted" ? t("guarantees_accept_success") : t("guarantees_reject_success") })
    } catch (err) {
      console.error("Failed to review guarantee:", err)
      toast({ title: t("guarantees_review_error"), variant: "destructive" })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Card className="border-amber-200/60 bg-amber-50/30 hover:shadow-md transition-shadow">
      <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <ShieldCheck size={22} className="text-amber-600" />
          </div>

          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Package size={11} />
                {t("guarantees_item_label")}
              </p>
              <p className="font-bold text-slate-800 text-sm truncate">{guarantee.itemName || guarantee.itemNameEn || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Building2 size={11} />
                {t("guarantees_supplier_label")}
              </p>
              <p className="font-semibold text-slate-700 text-sm truncate">{guarantee.supplierName || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Calendar size={11} />
                {t("guarantees_expiration_label")}
              </p>
              <p className={cn("text-sm font-semibold", isExpired ? "text-destructive" : "text-slate-700")} suppressHydrationWarning>
                {guarantee.expirationDate ? fmtDate(guarantee.expirationDate, locale) : "–"}
                {isExpired && <span className="ms-1.5 text-[10px] font-bold">({t("guarantees_expired_tag")})</span>}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5">{t("guarantees_status_label")}</p>
              {statusBadge(guarantee.status, t)}
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-2 shrink-0">
            {guarantee.fileUrl && (
              <Button asChild size="sm" variant="outline" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-600 hover:text-white hover:border-amber-600">
                <a href={guarantee.fileUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} />
                  {t("guarantees_view_file")}
                  <ExternalLink size={12} />
                </a>
              </Button>
            )}
            {guarantee.status === "pending_review" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-8 bg-success hover:bg-success/90 gap-1.5"
                  onClick={() => handleReview("accepted")}
                  disabled={isUpdating}
                >
                  {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  {t("guarantees_accept_btn")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/30 text-destructive hover:bg-destructive hover:text-white"
                  onClick={() => handleReview("rejected")}
                  disabled={isUpdating}
                >
                  <ShieldX size={13} />
                  {t("guarantees_reject_btn")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function GuaranteesPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  const guaranteesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(
      collection(firestore, "guarantees"),
      where("contractorOrgId", "==", myOrgId),
      where("hasGuarantee", "==", true)
    )
  }, [firestore, user, isUserLoading, myOrgId])

  const { data: guarantees, isLoading } = useCollection(guaranteesQuery)

  const getTime = (v: unknown) =>
    v && typeof v === "object" && "toDate" in v
      ? (v as { toDate: () => Date }).toDate().getTime()
      : v ? new Date(v as string).getTime() : 0

  const groupsByRfq = new Map<string, { rfqId?: string; rfqTitle: string; items: Guarantee[] }>()
  ;((guarantees || []) as Guarantee[]).forEach((g) => {
    const key = g.rfqId || g.rfqTitle || "unknown"
    if (!groupsByRfq.has(key)) {
      groupsByRfq.set(key, { rfqId: g.rfqId, rfqTitle: g.rfqTitle || "—", items: [] })
    }
    groupsByRfq.get(key)!.items.push(g)
  })
  const rfqGroups = Array.from(groupsByRfq.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt)),
    }))
    .sort((a, b) => getTime(b.items[0]?.createdAt) - getTime(a.items[0]?.createdAt))

  const pageLoading = isUserLoading || (isLoading && !guarantees)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("guarantees_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("guarantees_desc")}</p>
          </div>
        </div>

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : rfqGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
            <ShieldCheck size={48} className="text-muted-foreground/30" />
            <div>
              <p className="text-muted-foreground font-medium">{t("guarantees_empty")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("guarantees_empty_desc")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {rfqGroups.map((group) => (
              <div key={group.rfqId || group.rfqTitle} className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={16} className="text-primary shrink-0" />
                    <h2 className="font-bold text-slate-800 text-base truncate">{group.rfqTitle}</h2>
                    <Badge variant="outline" className="text-xs shrink-0">{group.items.length}</Badge>
                  </div>
                  {group.rfqId && (
                    <Link
                      href={`/contractor/rfqs/${group.rfqId}/offers`}
                      className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline shrink-0"
                    >
                      {t("guarantees_view_rfq")}
                      <ArrowRight size={12} className={cn(locale === "ar" && "rotate-180")} />
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4">
                  {group.items.map((guarantee) => (
                    <GuaranteeCard key={guarantee.id} guarantee={guarantee} locale={locale} t={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
