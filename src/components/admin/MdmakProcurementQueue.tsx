"use client"

import { useState, useMemo } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useFirestore, useUser, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, orderBy, limit } from "firebase/firestore"
import { motion, AnimatePresence } from "framer-motion"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/routing"
import {
  Search, Loader2, FileText, Calendar, TrendingUp,
  Clock, CheckCircle2, XCircle, Truck, Package2,
  Handshake, BarChart3, DollarSign, AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { displayCategory } from "@/lib/constants"
import { CreateMdmakOfferDialog } from "@/components/admin/CreateMdmakOfferDialog"
import type { MdmakProcurement } from "@/lib/mdmak-procurement"

type ProcStatus = MdmakProcurement["status"] | "pending"

const STATUS_CONFIG: Record<ProcStatus, { label_key: string; bg: string; text: string; icon: React.ElementType }> = {
  pending:      { label_key: "status_pending",     bg: "bg-slate-100",   text: "text-slate-600",  icon: Clock },
  offer_sent:   { label_key: "status_offer_sent",  bg: "bg-blue-50",     text: "text-blue-700",   icon: TrendingUp },
  accepted:     { label_key: "status_accepted",    bg: "bg-success/10",  text: "text-success",    icon: CheckCircle2 },
  rejected:     { label_key: "status_rejected",    bg: "bg-red-50",      text: "text-red-600",    icon: XCircle },
  in_progress:  { label_key: "status_in_progress", bg: "bg-amber-50",    text: "text-amber-700",  icon: Truck },
  delivered:    { label_key: "status_delivered",   bg: "bg-accent/10",   text: "text-accent",     icon: Package2 },
}

function StatusBadge({ status, t }: { status: ProcStatus; t: ReturnType<typeof useTranslations> }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold", cfg.bg, cfg.text)}>
      <Icon size={11} />
      {t(cfg.label_key)}
    </span>
  )
}

export function MdmakProcurementQueue() {
  const t = useTranslations("Portal.Admin.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | ProcStatus>("all")
  const [dialogRfq, setDialogRfq] = useState<{ id: string; title?: string; contractorId?: string; organizationId?: string } | null>(null)

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), orderBy("createdAt", "desc"), limit(100))
  }, [firestore, user, isUserLoading])

  const procQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "mdmakProcurement"), orderBy("createdAt", "desc"))
  }, [firestore, user, isUserLoading])

  const { data: rfqs, isLoading: rfqsLoading } = useCollection(rfqsQuery)
  const { data: procDocs, isLoading: procLoading } = useCollection<MdmakProcurement>(procQuery)

  const procByRfq = useMemo(() => {
    const map: Record<string, MdmakProcurement> = {}
    procDocs?.forEach(p => { map[p.rfqId] = p })
    return map
  }, [procDocs])

  const enriched = useMemo(() => {
    if (!rfqs) return []
    return rfqs.map((rfq: Record<string, unknown>) => ({
      rfq,
      proc: procByRfq[(rfq.id as string)] ?? null,
      procStatus: (procByRfq[(rfq.id as string)]?.status ?? "pending") as ProcStatus,
      isDirectOrder: !!rfq.orderedFromMdmakDirect,
    }))
  }, [rfqs, procByRfq])

  const filtered = useMemo(() => enriched
    .filter(({ rfq, procStatus }) => {
      if (filter !== "all" && procStatus !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        return (rfq.title as string || "").toLowerCase().includes(q)
      }
      return true
    })
    // Contractors who explicitly asked to order from Mdmak directly need a faster
    // response than RFQs Mdmak is opportunistically bidding on — surface those first.
    .sort((a, b) => {
      if (a.procStatus === "pending" && b.procStatus === "pending") {
        return (b.isDirectOrder ? 1 : 0) - (a.isDirectOrder ? 1 : 0)
      }
      return 0
    }), [enriched, filter, search])

  const stats = useMemo(() => {
    const total = enriched.length
    const pending = enriched.filter(e => e.procStatus === "pending").length
    const sent = enriched.filter(e => e.procStatus !== "pending").length
    const revenue = procDocs?.reduce((sum, p) => sum + (p.commissionAmount ?? 0), 0) ?? 0
    return { total, pending, sent, revenue }
  }, [enriched, procDocs])

  const isLoading = rfqsLoading || procLoading

  const FILTERS: Array<{ key: "all" | ProcStatus; label_key: string }> = [
    { key: "all", label_key: "filter_all" },
    { key: "pending", label_key: "filter_pending" },
    { key: "offer_sent", label_key: "filter_sent" },
    { key: "accepted", label_key: "filter_accepted" },
    { key: "rejected", label_key: "filter_rejected" },
    { key: "in_progress", label_key: "filter_in_progress" },
    { key: "delivered", label_key: "filter_delivered" },
  ]

  return (
    <PortalLayout>
      <div className={cn("max-w-6xl mx-auto py-8 space-y-8", locale === "ar" ? "text-right" : "text-left")}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-accent/10 flex items-center justify-center">
                <Handshake size={20} className="text-accent" />
              </div>
              {t("page_title")}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">{t("page_desc")}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: t("stats_total"),   value: stats.total,   icon: FileText,   color: "text-primary",   bg: "bg-primary/5" },
            { label: t("stats_pending"), value: stats.pending, icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
            { label: t("stats_sent"),    value: stats.sent,    icon: TrendingUp, color: "text-blue-600",  bg: "bg-blue-50" },
            { label: t("stats_revenue"), value: `${stats.revenue.toLocaleString("ar-SA")} ${t("sar")}`, icon: DollarSign, color: "text-success", bg: "bg-success/10" },
          ].map(s => (
            <Card key={s.label} className="border-none shadow-sm">
              <CardContent className="p-5 flex items-center gap-3">
                <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", s.bg)}>
                  <s.icon size={18} className={s.color} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                  <p className="text-xl font-black text-foreground">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search size={15} className={cn("absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none", locale === "ar" ? "right-3.5" : "left-3.5")} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("search_placeholder")}
              className={cn("h-10 rounded-xl border-border", locale === "ar" ? "pr-10" : "pl-10")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all",
                  filter === f.key
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/60"
                )}
              >
                {t(f.label_key)}
                {f.key === "all" && ` (${stats.total})`}
                {f.key === "pending" && ` (${stats.pending})`}
              </button>
            ))}
          </div>
        </div>

        {/* RFQ List */}
        {isLoading ? (
          <div className="flex justify-center items-center py-24">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-3xl bg-muted mx-auto flex items-center justify-center mb-4">
              <BarChart3 size={28} className="text-muted-foreground" />
            </div>
            <p className="font-bold text-foreground">{t("no_rfqs")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("no_rfqs_desc")}</p>
          </div>
        ) : (
          <motion.div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map(({ rfq, proc, procStatus, isDirectOrder }, i) => (
                <motion.div
                  key={rfq.id as string}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Card className={cn(
                    "border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden",
                    isDirectOrder && procStatus === "pending" && "border-accent/40 ring-1 ring-accent/20",
                    !isDirectOrder && procStatus === "accepted" && "border-success/30",
                    !isDirectOrder && procStatus === "pending" && "border-amber-200/60",
                    !isDirectOrder && procStatus === "offer_sent" && "border-blue-100",
                  )}>
                    <CardContent className="p-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5">
                        {/* Left — icon */}
                        <div className={cn(
                          "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
                          procStatus === "pending" ? "bg-amber-50" : "bg-accent/10"
                        )}>
                          <FileText size={18} className={procStatus === "pending" ? "text-amber-600" : "text-accent"} />
                        </div>

                        {/* Middle — RFQ info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h3 className="font-bold text-foreground text-sm leading-snug truncate">
                              {(rfq.title as string) || rfq.id as string}
                            </h3>
                            {isDirectOrder && (
                              <Badge className="text-[10px] bg-accent text-primary border-none shrink-0 gap-1">
                                <Handshake size={10} />
                                {t("direct_order_badge")}
                              </Badge>
                            )}
                            {(rfq.category as string | undefined) && (
                              <Badge variant="secondary" className="text-[10px] bg-primary/5 text-primary border-none shrink-0">
                                {displayCategory(rfq.category as string, locale)}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar size={11} />
                              {rfq.createdAt ? new Date(rfq.createdAt as string).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US") : "—"}
                            </span>
                            {proc && (
                              <span className="flex items-center gap-1 font-semibold text-foreground">
                                {t("detail_final_price")}: {proc.finalPrice?.toLocaleString("ar-SA")} {t("sar")}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right — status + actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge status={procStatus} t={t} />
                          {procStatus === "pending" ? (
                            <Button
                              size="sm"
                              onClick={() => setDialogRfq({ id: rfq.id as string, title: rfq.title as string, contractorId: rfq.contractorId as string, organizationId: rfq.organizationId as string })}
                              className="h-8 rounded-xl gap-1.5 bg-accent hover:bg-accent/90 text-primary font-bold text-xs shadow-sm shadow-accent/20"
                            >
                              <TrendingUp size={13} />
                              {t("create_offer_btn")}
                            </Button>
                          ) : (
                            <Link href={`/admin/rfqs/${rfq.id as string}`}>
                              <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs">
                                {t("view_offer_btn")}
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>

                      {/* Procurement detail bar */}
                      {proc && (
                        <div className="border-t border-border/50 px-5 py-3 bg-muted/20 flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>{t("detail_internal_cost")}: <strong className="text-foreground">{proc.internalCost?.toLocaleString("ar-SA")} {t("sar")}</strong></span>
                          <span>{t("detail_commission_rate")}: <strong className="text-amber-600">{proc.commissionRate}%</strong></span>
                          <span>{t("detail_commission_amount")}: <strong className="text-amber-600">{proc.commissionAmount?.toLocaleString("ar-SA")} {t("sar")}</strong></span>
                          <span>{t("detail_final_price")}: <strong className="text-accent">{proc.finalPrice?.toLocaleString("ar-SA")} {t("sar")}</strong></span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <CreateMdmakOfferDialog
        open={!!dialogRfq}
        onClose={() => setDialogRfq(null)}
        rfq={dialogRfq}
      />
    </PortalLayout>
  )
}
