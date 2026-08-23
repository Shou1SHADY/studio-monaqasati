"use client"

import Image from "next/image"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  FileText,
  Trophy,
  PlusCircle,
  ArrowUpRight,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Star,
  Clock,
  ChevronUp,
  ChevronDown
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc } from "firebase/firestore"
import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { useWorkQueue, type WorkQueueItem } from "@/hooks/useWorkQueue"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { usePermissions } from "@/hooks/usePermissions"
import { MoneyFlowViz } from "@/components/contractor/MoneyFlowViz"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Package, Truck, AlertTriangle, CircleDot, Banknote, Inbox, Timer, FolderKanban, Warehouse, Users2, Receipt, Crown, UsersRound } from "lucide-react"

function describeQueueItem(item: WorkQueueItem, t: ReturnType<typeof useTranslations<"Portal.Contractor">>) {
  switch (item.type) {
    case "rfq_decision":
      return {
        icon: FileText,
        iconColor: "text-accent",
        text: t("queue_item_rfq_decision", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), count: item.data.offerCount as number }),
      }
    case "rfq_no_offers":
      return {
        icon: Inbox,
        iconColor: "text-slate-500",
        text: t("queue_item_rfq_no_offers", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), days: item.data.daysOpen as number }),
      }
    case "rfq_closing_soon":
      return {
        icon: Timer,
        iconColor: "text-red-600",
        text: item.data.isOverdue
          ? t("queue_item_rfq_deadline_passed", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set") })
          : t("queue_item_rfq_closing_soon", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), hours: item.data.hoursLeft as number }),
      }
    case "delivery_confirm":
      return {
        icon: Truck,
        iconColor: "text-amber-600",
        text: t("queue_item_delivery_confirm", { supplierName: (item.data.supplierName as string) || t("queue_generic_supplier") }),
      }
    case "invoice_overdue":
      return {
        icon: AlertTriangle,
        iconColor: "text-destructive",
        text: t("queue_item_invoice_overdue", { invoiceNumber: (item.data.invoiceNumber as string) || "" }),
      }
    case "low_stock":
      return {
        icon: Package,
        iconColor: "text-orange-600",
        text: t("queue_item_low_stock", { itemName: (item.data.itemName as string) || "", warehouseName: (item.data.warehouseName as string) || "" }),
      }
  }
}

export default function ContractorDashboard() {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const t = useTranslations("Portal.Contractor");
  const locale = useLocale();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  const formatActivityDate = (date: Date | null) => {
    if (!date) return null;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("now");
    if (diffMins < 60) return t("minute_ago", { minutes: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("hour_ago", { hours: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t("day_ago", { days: diffDays });
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const getLastActivityDate = () => {
    if (!rfqs || rfqs.length === 0) return null;
    const sortedRfqs = [...rfqs].sort((a: any, b: any) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    const lastRfq = sortedRfqs[0];
    return lastRfq?.createdAt ? new Date(lastRfq.createdAt) : null;
  }

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = profile?.organizationId || user?.uid
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const { can, isOrgOwner, groups } = usePermissions()

  // --- Personalization: who is this, and what can they act on? ---
  const firstName = (profile?.name as string | undefined)?.trim().split(/\s+/)[0] || ""
  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? t("greet_morning") : t("greet_evening")
  const todayLabel = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { weekday: "long", day: "numeric", month: "long" })
  const myGroup = groups.find((g) => g.id === profile?.defaultGroupId)
  const roleChip = isOrgOwner ? t("role_owner_chip") : myGroup?.name || null

  // Queue items only appear if this member can actually act on them — a
  // finance member shouldn't wake up to RFQ decisions they can't take.
  const queuePermission: Record<WorkQueueItem["type"], boolean> = {
    rfq_decision: can("offers.view") || can("rfq.manage"),
    rfq_no_offers: can("rfq.manage") || can("rfq.create"),
    rfq_closing_soon: can("rfq.manage") || can("rfq.create"),
    delivery_confirm: can("deliveries.confirm"),
    invoice_overdue: can("invoices.manage"),
    low_stock: can("warehouses.manage"),
  }
  const { items: allQueueItems, isLoading: queueLoading } = useWorkQueue(myOrgId)
  const queueItems = allQueueItems.filter((item) => queuePermission[item.type])
  const QUEUE_COLLAPSED_LIMIT = 5
  const [visibleQueueCount, setVisibleQueueCount] = useState(QUEUE_COLLAPSED_LIMIT)
  const visibleQueueItems = queueItems.slice(0, visibleQueueCount)
  const showAllQueue = visibleQueueCount >= queueItems.length

  // Personalized shortcuts — only destinations this member can actually use.
  const quickActions = [
    { key: "projects", label: t("qa_projects"), icon: FolderKanban, href: "/contractor/projects", show: true },
    { key: "rfqs", label: t("qa_rfqs"), icon: FileText, href: "/contractor/rfqs", show: can("rfq.manage") || can("rfq.create") },
    { key: "invoices", label: t("qa_invoices"), icon: Receipt, href: "/contractor/invoices", show: can("invoices.manage") },
    { key: "warehouses", label: t("qa_warehouses"), icon: Warehouse, href: "/contractor/warehouses", show: can("warehouses.manage") },
    { key: "suppliers", label: t("qa_suppliers"), icon: Users2, href: "/contractor/suppliers", show: can("suppliers.manage") },
    { key: "team", label: t("qa_team"), icon: UsersRound, href: "/contractor/team", show: can("team.manage") },
  ].filter((a) => a.show)

  const showMoneyFlow = isOrgOwner || can("invoices.manage") || can("offers.accept")

  const [selectedProjectId, setSelectedProjectId] = useState<string>("")

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: projectsData } = useCollection(projectsQuery)
  const orgProjects = ((projectsData || []) as { id: string; name?: string; status?: string; updatedAt?: unknown }[]).slice().sort((a, b) => {
    const toMs = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate().getTime() : 0
    return toMs(b.updatedAt) - toMs(a.updatedAt)
  })
  // Default the money-flow widget to the most-recently-updated project that's
  // still live — a finished/canceled project's spend breakdown isn't useful
  // as the first thing shown. Falls back to the newest project of any status
  // if every project happens to be closed out.
  const defaultProjectId = orgProjects.find((p) => p.status !== "canceled" && p.status !== "remaining_payment")?.id || orgProjects[0]?.id || ""
  const activeProjectId = selectedProjectId || defaultProjectId

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: rfqs } = useCollection(rfqsQuery)

  const activeRfqsCount = rfqs?.filter((r: any) => r.status === "New").length || 0;
  const awardedCount = rfqs?.filter((r: any) => r.status === "Awarded").length || 0;

  // Extract RFQ IDs to find accepted offers
  const myRfqIds = rfqs?.map((r: any) => r.id) || [];
  const acceptedOffersQuery = useMemoFirebase(() => {
    if (!firestore || !profile || !user) return null
    return query(collection(firestore, "offers"),
      where("contractorOrgId", "==", profile.organizationId || user.uid)
    )
  }, [firestore, profile?.organizationId, user?.uid])

  const { data: offersData } = useCollection(acceptedOffersQuery)
  const totalOffersCount = offersData?.length || 0;
  const pendingOffersCount = offersData?.filter((o: any) => o.status === "قيد المراجعة").length || 0;
  
  const lastActivityDate = getLastActivityDate();

  // Stats are role-aware: each card shows only if the member can act in that
  // domain; the projects card fills in so restricted members still see a full row.
  const allStats = [
    { visible: true, title: t("stat_projects_title"), value: orgProjects.length.toString(), icon: FolderKanban, color: "text-cta", bg: "bg-cta/10", glow: "group-hover:shadow-[0_0_20px_rgba(3,105,161,0.15)]", gradient: "group-hover:from-sky-50 group-hover:to-sky-100/50", action: t("qa_projects"), actionUrl: "/contractor/projects", trend: undefined as { value: number; isPositive: boolean } | undefined, context: t("stat_projects_context") },
    { visible: can("rfq.manage") || can("rfq.create") || isOrgOwner, title: t("active_tenders"), value: activeRfqsCount.toString(), icon: FileText, color: "text-accent", bg: "bg-accent/10", glow: "group-hover:shadow-[0_0_20px_rgba(32,203,213,0.15)]", gradient: "group-hover:from-accent/5 group-hover:to-cyan-50/50", action: t("browse_tenders"), actionUrl: "/contractor/rfqs", trend: activeRfqsCount > 0 ? { value: 12, isPositive: true } : undefined, context: activeRfqsCount === 0 ? t("active_tenders_empty") : t("active_tenders_count", { count: activeRfqsCount }) },
    { visible: can("offers.view") || isOrgOwner, title: t("awarded_contracts"), value: awardedCount.toString(), icon: Trophy, color: "text-amber-600", bg: "bg-amber-50", glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]", gradient: "group-hover:from-amber-50 group-hover:to-amber-100/50", action: t("view_contracts"), actionUrl: "/contractor/rfqs?status=Awarded", trend: awardedCount > 0 ? { value: 5, isPositive: true } : undefined, context: t("awarded_contracts_context") },
    { visible: can("offers.view") || isOrgOwner, title: t("offers_received"), value: totalOffersCount.toString(), icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", glow: "group-hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]", gradient: "group-hover:from-violet-50 group-hover:to-violet-100/50", action: t("review_offers"), actionUrl: "/contractor/rfqs", context: totalOffersCount === 0 ? t("offers_received_empty") : pendingOffersCount > 0 ? t("offers_received_pending", { count: pendingOffersCount }) : t("connected_suppliers_context") },
  ]
  const visibleStats = allStats.filter((s) => s.visible)
  // Owners see the classic 3 domain cards; the projects card leads only when
  // it's needed to keep the row meaningful for restricted members.
  const stats = visibleStats.length > 3 ? visibleStats.slice(1) : visibleStats

  if (!profile || !rfqs) {
    return (
      <PortalLayout>
        <div className="space-y-8 pb-10">
          {/* Mirrors the real layout heights so content doesn't jump when data lands */}
          <Skeleton className="h-36 sm:h-[72px] rounded-2xl w-full" />
          <div className="flex items-center gap-2 -mt-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-9 w-24 rounded-full" />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map(i => <Skeleton key={i} className="h-52 rounded-lg" />)}
          </div>
          <Skeleton className="h-64 rounded-lg w-full" />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-8 pb-10">
        {/* Welcome Banner */}
        <div
          className="relative overflow-hidden rounded-2xl isolate flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 sm:px-6 sm:py-3.5 text-white"
          style={{
            background: `
              radial-gradient(110% 140% at ${locale === 'ar' ? '35%' : '65%'} 10%, rgba(37,99,235,.30) 0%, transparent 55%),
              radial-gradient(80% 110% at ${locale === 'ar' ? '65%' : '35%'} 100%, rgba(30,58,138,.35) 0%, transparent 58%),
              linear-gradient(115deg, #0b1a33 0%, #0a1426 46%, #060d1c 100%)
            `,
            boxShadow: '0 10px 28px -10px rgba(3,8,22,.30), inset 0 1px 0 rgba(255,255,255,.06), inset 0 0 0 1px rgba(255,255,255,.05)',
          }}
        >
          {/* Blueprint crane illustration — centered between text and CTA */}
          <div
            className="absolute pointer-events-none select-none max-sm:opacity-20"
            style={{
              left: locale === 'ar' ? '20%' : '34%',
              right: locale === 'ar' ? '40%' : '22%',
              top: '-4%',
              bottom: '0',
              WebkitMaskImage: locale === 'ar'
                ? 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.3) 8%, rgba(0,0,0,.85) 20%, #000 30%, #000 82%, rgba(0,0,0,.6) 92%, transparent 100%)'
                : 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.6) 8%, #000 18%, #000 70%, rgba(0,0,0,.85) 80%, rgba(0,0,0,.3) 92%, transparent 100%)',
              maskImage: locale === 'ar'
                ? 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.3) 8%, rgba(0,0,0,.85) 20%, #000 30%, #000 82%, rgba(0,0,0,.6) 92%, transparent 100%)'
                : 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.6) 8%, #000 18%, #000 70%, rgba(0,0,0,.85) 80%, rgba(0,0,0,.3) 92%, transparent 100%)',
            }}
          >
            <Image
              src="/images/blueprint-crane-trim.png"
              alt=""
              fill
              className={locale === 'ar' ? 'object-cover' : 'object-contain'}
              style={{ objectPosition: locale === 'ar' ? '55% 40%' : '50% 35%', opacity: 0.95 }}
              sizes="1024px"
              priority={false}
            />
          </div>

          {/* Dual-edge fade: keeps text and CTA readable over dark navy */}
          <div
            className="absolute inset-0 pointer-events-none z-[1]"
            style={{
              background: locale === 'ar'
                ? 'linear-gradient(to right, #0a1426 0%, rgba(10,20,38,.85) 12%, rgba(10,20,38,.2) 28%, transparent 48%, rgba(10,20,38,.2) 68%, rgba(10,20,38,.85) 85%, #0a1426 100%)'
                : 'linear-gradient(to right, #0a1426 0%, rgba(10,20,38,.85) 15%, rgba(10,20,38,.2) 32%, transparent 52%, rgba(10,20,38,.2) 72%, rgba(10,20,38,.85) 88%, #0a1426 100%)',
            }}
          />

          {/* Text content — personal greeting first, company context second */}
          <div className="relative z-[2] flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 suppressHydrationWarning className={cn("text-[16px] sm:text-[19px] font-black text-white leading-[1.2]", locale !== 'ar' && "tracking-[-0.02em]")}>
                {greeting}{locale === 'ar' ? '،' : ','}{' '}
                <span className={cn("text-transparent bg-clip-text", locale === 'ar' ? 'bg-gradient-to-l from-accent to-cyan-300' : 'bg-gradient-to-r from-accent to-cyan-300')}>
                  {firstName || activeCompanyName || t("welcome_fallback")}
                </span>
              </h1>
              {roleChip && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 backdrop-blur-md border border-accent/30 text-[11.5px] font-bold text-accent whitespace-nowrap">
                  {isOrgOwner ? <Crown className="h-3 w-3" /> : <UsersRound className="h-3 w-3" />}
                  {roleChip}
                </span>
              )}
              {lastActivityDate && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] backdrop-blur-md border border-white/[0.14] text-[11.5px] font-semibold text-slate-300 whitespace-nowrap">
                  <Clock className="h-3 w-3 text-blue-300" />
                  {t("last_activity")}: {formatActivityDate(lastActivityDate)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] text-slate-400 font-medium truncate">
              {activeCompanyName || t("welcome_fallback")}
              <span className="mx-1.5 text-slate-600">·</span>
              <span suppressHydrationWarning>{todayLabel}</span>
            </p>
          </div>

          {/* CTA Button — tenders now only get created from inside a project;
              hidden for members whose role can't publish RFQs at all */}
          {/* Single <a> styled as a button — a <button> nested inside a Link is
              invalid HTML and can swallow the click, leaving the banner CTA dead */}
          {(isOrgOwner || can("rfq.create") || can("projects.edit")) && (
            <Link
              href="/contractor/projects"
              className="relative z-[2] shrink-0 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 h-9 rounded-[10px] bg-white text-[#0b1a33] text-[13px] font-bold hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-14px_rgba(0,0,0,.6)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              style={{ boxShadow: '0 12px 26px -12px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.6)' }}
            >
              <PlusCircle className="h-4 w-4" />
              {t("new_tender_cta")}
            </Link>
          )}
        </div>

        {/* Personalized shortcuts — only what this member can actually do */}
        {quickActions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap -mt-3">
            {quickActions.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full border border-border bg-background text-[13px] font-bold text-slate-700 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <a.icon className="h-3.5 w-3.5" />
                {a.label}
              </Link>
            ))}
          </div>
        )}

        {/* Stats Grid - Primary KPIs per 5-second rule */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className={`glass-card border-none shadow-sm overflow-hidden group hover:-translate-y-1 hover:shadow-xl transition-all duration-300 ${stat.gradient}`}>
              <CardContent className="p-6">
                <Link href={stat.actionUrl || "#"} className="block">
                  <div className="flex items-center justify-between mb-4">
                    <div className={cn("p-3.5 rounded-lg transition-all duration-300", stat.bg, stat.glow)}>
                      <stat.icon className={cn("h-6 w-6", stat.color)} strokeWidth={2.5} />
                    </div>
                    <div className="flex items-center gap-2">
                      {stat.trend && (
                        <span className={cn(
                          "flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full",
                          stat.trend.isPositive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        )}>
                          {stat.trend.isPositive ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {stat.trend.value}%
                        </span>
                      )}
                      <ArrowUpRight className={cn("h-5 w-5 text-muted-foreground transition-all duration-300", locale === 'ar' ? 'group-hover:translate-x-1 group-hover:-translate-y-1' : 'group-hover:-translate-x-1 group-hover:-translate-y-1')} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-muted-foreground">{stat.title}</p>
                    <p className="text-3xl font-black text-foreground tracking-tight">{stat.value}</p>
                    {stat.context && (
                      <p className="text-xs text-muted-foreground/80">{stat.context}</p>
                    )}
                  </div>
                  {stat.action && (
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary group-hover:underline">
                        {stat.action}
                        <ArrowRight className={cn("h-3 w-3", locale === 'ar' && "rtl-flip")} />
                      </span>
                    </div>
                  )}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          {/* Your Work Today — prioritized action queue */}
          <Card className="shadow-md border-none overflow-hidden glass-card">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border bg-muted/50 pb-4">
              <CardTitle className="text-lg font-black flex items-center gap-2 text-foreground">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <CircleDot className="h-5 w-5 text-primary" />
                </div>
                {t("queue_title")}
                {queueItems.length > 0 && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">
                    {queueItems.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/80">
                {queueLoading ? (
                  <div className="p-12 flex items-center justify-center">
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
                ) : queueItems.length > 0 ? visibleQueueItems.map((item) => {
                  const { icon: Icon, iconColor, text } = describeQueueItem(item, t)
                  return (
                    <Link
                      key={item.id}
                      href={item.actionUrl}
                      className="p-5 hover:bg-muted/80 transition-colors flex items-center justify-between gap-4 group cursor-pointer block"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className={cn("h-12 w-12 rounded-lg bg-background border shadow-sm flex items-center justify-center shrink-0 transition-transform duration-300", !prefersReducedMotion && "group-hover:scale-105")}>
                          <Icon className={cn("h-5 w-5", iconColor)} />
                        </div>
                        <p className="text-sm font-bold text-foreground group-hover:text-accent transition-colors truncate min-w-0 flex-1">{text}</p>
                      </div>
                      <ArrowRight className={cn("h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity", locale === 'ar' && "rtl-flip")} />
                    </Link>
                  )
                }) : (
                  <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center">
                      <CircleDot className="h-8 w-8 text-slate-300" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">{t("queue_empty")}</p>
                    </div>
                  </div>
                )}
              </div>
              {queueItems.length > QUEUE_COLLAPSED_LIMIT && (
                <button
                  type="button"
                  onClick={() =>
                    setVisibleQueueCount((c) =>
                      showAllQueue ? QUEUE_COLLAPSED_LIMIT : Math.min(c + QUEUE_COLLAPSED_LIMIT, queueItems.length)
                    )
                  }
                  className="w-full p-3.5 flex items-center justify-center gap-1.5 text-sm font-bold text-primary hover:bg-muted/60 transition-colors border-t border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  {showAllQueue ? t("queue_view_less") : t("queue_view_more", { count: queueItems.length - visibleQueueCount })}
                  {showAllQueue ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Money Flow — financial visibility only */}
        {showMoneyFlow && orgProjects.length > 0 && (
          <Card className="shadow-md border-none overflow-hidden glass-card">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border bg-muted/50 pb-4 flex-wrap gap-3">
              <CardTitle className="text-lg font-black flex items-center gap-2 text-foreground">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Banknote className="h-5 w-5 text-primary" />
                </div>
                {t("moneyflow_title")}
              </CardTitle>
              {orgProjects.length > 1 && (
                <Select value={activeProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger className="w-56 h-9 text-sm">
                    <SelectValue placeholder={t("moneyflow_project_selector_label")} />
                  </SelectTrigger>
                  <SelectContent>
                    {orgProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardHeader>
            <CardContent className="p-6">
              {activeProjectId && <MoneyFlowViz projectId={activeProjectId} />}
            </CardContent>
          </Card>
        )}

        {/* Favorites now live inline in the supplier directory, not as a separate dashboard section */}
        <Link href="/contractor/suppliers" className="block">
          <div className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-slate-200 bg-white hover:border-primary/40 hover:shadow-sm transition-all group">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-amber-50 flex items-center justify-center">
                <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
              </div>
              <div>
                <p className="font-black text-slate-800">{t("favorite_suppliers")}</p>
                <p className="text-sm text-slate-500">{t("favorite_suppliers_desc")}</p>
              </div>
            </div>
            <ArrowRight className={cn("h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors", locale === 'ar' && "rtl-flip")} />
          </div>
        </Link>
      </div>
    </PortalLayout>
  )
}
