"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { 
  FileText, 
  Users, 
  Trophy, 
  Activity, 
  PlusCircle,
  ArrowUpRight,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  History,
  Star,
  Award,
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

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const usersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Supplier"))
  }, [firestore, user, isUserLoading])

  const { data: rfqs } = useCollection(rfqsQuery)
  const { data: suppliers } = useCollection(usersQuery)

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
  
  const implicitFavoriteIds = offersData
    ?.filter((o: any) => o.status === "مقبول")
    .map((o: any) => o.supplierId) || []
  const explicitFavoriteIds = profile?.favoriteSuppliers || []
  const favoriteSupplierIds = new Set([...implicitFavoriteIds, ...explicitFavoriteIds])

  const favoriteSuppliers = suppliers?.filter((s: any) => favoriteSupplierIds.has(s.id)) || [];
  const suppliersCount = favoriteSuppliers.length || 0;

  const lastActivityDate = getLastActivityDate();

  const stats = [
    { title: t("active_tenders"), value: activeRfqsCount.toString(), icon: FileText, color: "text-accent", bg: "bg-accent/10", glow: "group-hover:shadow-[0_0_20px_rgba(32,203,213,0.15)]", gradient: "group-hover:from-accent/5 group-hover:to-cyan-50/50", action: t("browse_tenders"), actionUrl: "/contractor/rfqs", trend: activeRfqsCount > 0 ? { value: 12, isPositive: true } : undefined, context: activeRfqsCount === 0 ? t("active_tenders_empty") : t("active_tenders_count", { count: activeRfqsCount }) },
    { title: t("awarded_contracts"), value: awardedCount.toString(), icon: Trophy, color: "text-amber-600", bg: "bg-amber-50", glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]", gradient: "group-hover:from-amber-50 group-hover:to-amber-100/50", action: t("view_contracts"), actionUrl: "/contractor/rfqs?status=Awarded", trend: awardedCount > 0 ? { value: 5, isPositive: true } : undefined, context: t("awarded_contracts_context") },
    { title: t("commitment_rate"), value: "90%", icon: Activity, color: "text-emerald-600", bg: "bg-emerald-50", glow: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]", gradient: "group-hover:from-emerald-50 group-hover:to-emerald-100/50", action: t("how_calculated"), actionUrl: "#", trend: { value: 2, isPositive: true }, context: t("commitment_rate_context") },
    { title: t("connected_suppliers"), value: suppliersCount.toString(), icon: Users, color: "text-violet-600", bg: "bg-violet-50", glow: "group-hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]", gradient: "group-hover:from-violet-50 group-hover:to-violet-100/50", action: t("browse_suppliers"), actionUrl: "/contractor/suppliers", context: t("connected_suppliers_context") },
  ]

  const recentActivity = [
    ...(rfqs?.slice(0, 3).map((r: any) => ({
      id: r.id, 
      type: "rfq", 
      text: t("rfq_created", { title: r.title || t("rfq_not_set") }), 
      time: r.createdAt ? new Date(r.createdAt).toLocaleDateString(locale) : t("now"), 
      status: r.status || t("rfq_status_new"),
      actionUrl: `/contractor/rfqs/${r.id}/offers`,
      actionLabel: r.status === "New" ? t("view_and_negotiate") : t("view_details")
    })) || [])
  ]

  if (!profile || !rfqs || !suppliers) {
    return (
      <PortalLayout>
        <div className="space-y-8 max-w-7xl mx-auto pb-10">
          <Skeleton className="h-48 rounded-3xl w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-lg" />)}
          </div>
          <Skeleton className="h-64 rounded-lg w-full" />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-8 max-w-7xl mx-auto pb-10">
        {/* Animated Header Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 text-white shadow-xl">
          {!prefersReducedMotion && (
            <>
              <div className={cn("absolute top-0 -mt-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl mix-blend-screen", locale === 'ar' ? '-mr-20 right-0' : '-ml-20 left-0')} />
              <div className={cn("absolute bottom-0 -mb-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl mix-blend-screen", locale === 'ar' ? '-ml-20 left-0' : '-mr-20 right-0')} />
            </>
          )}
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                  {t("welcome")}{locale === 'ar' ? '،' : ','} <span className={cn("text-transparent bg-clip-text", locale === 'ar' ? 'bg-gradient-to-l from-accent to-cyan-300' : 'bg-gradient-to-r from-accent to-cyan-300')}>{profile?.companyName || profile?.name || t("welcome_fallback")}</span>
                </h1>
                {lastActivityDate && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs font-medium text-white/80">
                    <Clock className="h-3 w-3" />
                    {t("last_activity")}: {formatActivityDate(lastActivityDate)}
                  </span>
                )}
              </div>
              <p className="text-slate-200 text-lg font-medium max-w-xl leading-relaxed">
                {t("smart_dashboard_desc")}
              </p>
            </div>
            <Link href="/contractor/rfqs/new" className="shrink-0">
              <Button className="bg-white text-secondary hover:bg-slate-100 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5)] transition-all duration-300 h-12 px-6 rounded-xl font-bold text-base group">
                <PlusCircle className={cn("h-5 w-5", locale === 'ar' ? 'ml-2' : 'mr-2', !prefersReducedMotion && "transition-transform group-hover:rotate-90")} />
                {t("new_tender_cta")}
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Grid - Primary KPIs per 5-second rule */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                        {locale === 'ar' ? <ArrowRight className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 rotate-180" />}
                      </span>
                    </div>
                  )}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity */}
          <Card className="lg:col-span-2 shadow-md border-none overflow-hidden glass-card">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border bg-muted/50 pb-4">
                <CardTitle className="text-lg font-black flex items-center gap-2 text-foreground">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <History className="h-5 w-5 text-primary" />
                </div>
                {t("recent_activities")}
              </CardTitle>
              <Link href="/contractor/rfqs">
                <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 hover:bg-primary/5 font-bold">{t("view_full_log")}</Button>
              </Link>
            </CardHeader>
<CardContent className="p-0">
                <div className="divide-y divide-border/80">
                {recentActivity.length > 0 ? recentActivity.map((activity) => (
                  <Link 
                    key={activity.id} 
                    href={activity.actionUrl}
                    className="p-5 hover:bg-muted/80 transition-colors flex items-center justify-between group cursor-pointer block"
                  >
                    <div className="flex items-center gap-4">
                        <div className={cn("h-12 w-12 rounded-lg bg-background border shadow-sm flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-300", !prefersReducedMotion && "group-hover:scale-105")}>
                        {activity.type === 'offer' && <TrendingUp className="h-5 w-5 text-emerald-500" />}
                        {activity.type === 'rfq' && <FileText className="h-5 w-5 text-accent" />}
                        {activity.type === 'award' && <Trophy className="h-5 w-5 text-amber-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground group-hover:text-accent transition-colors">{activity.text}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-border" />
                          <p className="text-[11px] font-medium text-muted-foreground" suppressHydrationWarning>{activity.time}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline-flex items-center gap-1">
                        {activity.actionLabel}
                        {locale === 'ar' ? <ArrowRight className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 rotate-180" />}
                      </span>
<Badge variant="secondary" className="bg-accent/10 text-accent font-bold px-3 py-1 rounded-full border-none">
                          {activity.status}
                        </Badge>
                    </div>
                  </Link>
                )) : (
                    <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center">
                      <Activity className="h-8 w-8 text-slate-300" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">{t("no_activities")}</p>
                      <p className="text-sm text-slate-500">{t("no_activities_desc")}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commitment Score Banner */}
          <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl overflow-hidden relative border-none group">
            {!prefersReducedMotion && (
              <>
                <div className={cn("absolute top-0 w-64 h-64 bg-accent/20 rounded-full blur-[80px] transition-all duration-700 group-hover:bg-accent/30 group-hover:scale-110", locale === 'ar' ? '-mr-20 -mt-20 right-0' : '-ml-20 -mt-20 left-0')} />
                <div className={cn("absolute bottom-0 w-64 h-64 bg-cyan-400/10 rounded-full blur-[80px] transition-all duration-700 group-hover:bg-cyan-400/20 group-hover:scale-110", locale === 'ar' ? '-ml-20 -mb-20 left-0' : '-mr-20 -mb-20 right-0')} />
              </>
            )}
            
            <div className={cn("absolute top-0 w-full h-1.5", locale === 'ar' ? 'bg-gradient-to-l from-accent/40 via-accent to-cyan-400' : 'bg-gradient-to-r from-accent/40 via-accent to-cyan-400')} />
            
            <CardHeader className="relative z-10 pb-2">
              <CardTitle className="text-lg font-black flex items-center gap-2 text-white/90">
                <div className="p-2 rounded-lg bg-white/10 backdrop-blur-sm border border-white/5">
                  <Activity className="h-5 w-5 text-accent" />
                </div>
                {t("commitment_index")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 relative z-10">
              <div className="flex items-center justify-center py-6">
                <div className="relative h-36 w-36 drop-shadow-[0_0_15px_rgba(32,203,213,0.3)]">
                  <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100" aria-label={`${t("commitment_index")} 90%`}>
                    <circle 
                      className="text-white/5" 
                      strokeWidth="8" 
                      stroke="currentColor" 
                      fill="transparent" 
                      r="42" 
                      cx="50" 
                      cy="50" 
                    />
                    <circle 
                      className={cn("text-accent drop-shadow-[0_0_8px_rgba(32,203,213,0.8)]", !prefersReducedMotion && "transition-all duration-1000 ease-out")} 
                      strokeWidth="8" 
                      strokeDasharray="263.89" 
                      strokeDashoffset="26.38" 
                      strokeLinecap="round" 
                      stroke="currentColor" 
                      fill="transparent" 
                      r="42" 
                      cx="50" 
                      cy="50" 
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-black tracking-tighter text-white" aria-label={`${t("commitment_rate")}: 90%`}>90<span className="text-xl text-accent">%</span></span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-center text-white/80 leading-relaxed font-medium px-4" dangerouslySetInnerHTML={{ __html: t.raw("commitment_desc") }}>
              </p>
              <Button className="w-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10 font-bold h-12 rounded-xl transition-all duration-300">
                {t("commitment_cta")}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Favorite Suppliers Section */}
        <div className="space-y-6 pt-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                <Star className="h-6 w-6 text-amber-400 fill-amber-400 drop-shadow-sm" />
                {t("favorite_suppliers")}
              </h2>
              <p className="text-sm text-slate-500 mt-1">{t("favorite_suppliers_desc")}</p>
            </div>
            <Link href="/contractor/suppliers">
              <Button variant="outline" className="rounded-xl font-bold bg-white hover:bg-primary hover:text-white hover:border-primary border-slate-200 shadow-sm transition-all duration-300">{t("manage_favorites")}</Button>
            </Link>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {favoriteSuppliers && favoriteSuppliers.length > 0 ? favoriteSuppliers.map((supplier: any) => (
              <Card key={supplier.id} className="border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 bg-white group rounded-2xl overflow-hidden">
                <div className={cn("h-1.5 w-full", locale === 'ar' ? 'bg-gradient-to-l from-slate-100 to-slate-200 group-hover:from-primary group-hover:to-blue-400' : 'bg-gradient-to-r from-slate-100 to-slate-200 group-hover:from-primary group-hover:to-blue-400')} />
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-slate-400 shrink-0 border border-slate-200 shadow-sm group-hover:scale-110 transition-transform duration-300">
                      <Users size={24} />
                    </div>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <h3 className="font-black text-slate-800 text-base truncate group-hover:text-primary transition-colors">{supplier.companyName || supplier.name || t("certified_supplier")}</h3>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 w-fit px-2 py-1 rounded-md">
                        <Award size={14} className="text-amber-500" />
                        <span className="font-medium">{t("previously_dealt")}</span>
                      </div>
                        <div className="flex gap-2 pt-3 flex-wrap">
                          <Badge variant="outline" className="text-[10px] bg-white border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-md shadow-sm">{t("suppliers_spec_building_materials")}</Badge>
                          <Badge variant="outline" className="text-[10px] bg-white border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-md shadow-sm">{t("suppliers_spec_cement")}</Badge>
                        </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) : (
              <div className="col-span-3 p-12 flex flex-col items-center justify-center text-center bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-3xl border border-dashed border-slate-200">
                <div className="h-16 w-16 rounded-full bg-white shadow-sm flex items-center justify-center mb-4">
                  <Star className="h-8 w-8 text-slate-300" />
                </div>
                <h3 className="font-bold text-slate-700 text-lg">{t("no_favorite_suppliers")}</h3>
                <p className="text-slate-500 max-w-md mt-2 leading-relaxed">
                  {t("no_favorite_suppliers_desc")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
