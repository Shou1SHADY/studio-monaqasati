"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Link } from "@/i18n/routing"
import {
  Users,
  FileText,
  Activity,
  ShieldAlert,
  ShieldCheck,
  BarChart3,
  PieChart as PieChartIcon,
  Clock,
  Building2,
  MapPin,
  Award,
  ChevronRight,
  Handshake,
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, limit } from "firebase/firestore"
import { useTranslations, useLocale } from 'next-intl'
import { displayCity } from "@/lib/constants"

function getTs(ts: unknown): number {
  if (!ts) return 0
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).getTime()
  if (typeof ts === 'object' && ts !== null) {
    if ('toDate' in ts && typeof (ts as any).toDate === 'function') return (ts as any).toDate().getTime()
    if ('seconds' in ts) return (ts as any).seconds * 1000
  }
  return 0
}

export default function AdminDashboard() {
  const t = useTranslations("Portal.Admin.Dashboard")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"))
  }, [firestore, user, isUserLoading])

  const usersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"))
  }, [firestore, user, isUserLoading])

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "offers"))
  }, [firestore, user, isUserLoading])

  const pendingVerifyQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users"),
      where("verificationRequested", "==", true),
      limit(5)
    )
  }, [firestore, user, isUserLoading])

  const recentRfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      orderBy("createdAt", "desc"),
      limit(8)
    )
  }, [firestore, user, isUserLoading])

  const { data: rfqs } = useCollection(rfqsQuery)
  const { data: users } = useCollection(usersQuery)
  const { data: offers } = useCollection(offersQuery)
  const { data: pendingVerify } = useCollection(pendingVerifyQuery)
  const { data: recentRfqs } = useCollection(recentRfqsQuery)

  // ── Users ──
  const suppliersTotal = users?.filter((u: any) => u.role === "Supplier").length || 0
  const contractorsTotal = users?.filter((u: any) => u.role === "Contractor").length || 0
  const verifiedSuppliers = users?.filter((u: any) => u.role === "Supplier" && u.isVerified).length || 0
  const verifiedContractors = users?.filter((u: any) => u.role === "Contractor" && u.isVerified).length || 0
  const pendingSuppliers = users?.filter((u: any) => u.role === "Supplier" && u.verificationRequested && !u.isVerified).length || 0
  const pendingContractors = users?.filter((u: any) => u.role === "Contractor" && u.verificationRequested && !u.isVerified).length || 0
  const totalPending = pendingSuppliers + pendingContractors

  // ── RFQs — drafts excluded from all analytics ──
  const publishedRfqsList = rfqs?.filter((r: any) => r.status !== "Draft") || []
  const activeRfqs = publishedRfqsList.filter((r: any) => r.status === "New").length
  const awardedRfqs = publishedRfqsList.filter((r: any) => r.status === "Awarded").length
  const completedRfqs = publishedRfqsList.filter((r: any) => r.status === "Completed").length
  const draftRfqs = rfqs?.filter((r: any) => r.status === "Draft").length || 0
  const publishedRfqs = activeRfqs + awardedRfqs + completedRfqs
  const closedRfqs = awardedRfqs + completedRfqs
  const awardRate = publishedRfqs > 0 ? Math.round((closedRfqs / publishedRfqs) * 100) : 0
  const mdmakDirectOrders = publishedRfqsList.filter((r: any) => r.orderedFromMdmakDirect).length

  // ── Offers ──
  const offersTotal = offers?.length || 0
  const avgOffersPerRfq = activeRfqs > 0 ? (offersTotal / activeRfqs).toFixed(1) : "—"

  // ── Monthly trend (last 6 months, published only) ──
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const count = publishedRfqsList.filter((r: any) => {
      const ts = getTs(r.createdAt)
      return ts >= d.getTime() && ts < monthEnd.getTime()
    }).length
    return {
      name: d.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', { month: 'short' }),
      rfqs: count,
    }
  })

  // ── Status distribution (donut — published only, drafts excluded) ──
  const statusSegments = [
    { name: t("status_new"), value: activeRfqs, color: "#10b981" },
    { name: t("status_awarded"), value: awardedRfqs, color: "#3b82f6" },
    { name: t("status_completed"), value: completedRfqs, color: "#8b5cf6" },
  ].filter(d => d.value > 0)
  const pieData = statusSegments.length > 0 ? statusSegments : [{ name: t("no_data"), value: 1, color: "#e2e8f0" }]

  // ── Top cities by RFQ volume (published only) ──
  const cityCounts = publishedRfqsList.reduce((acc: Record<string, number>, r: any) => {
    if (r.city) acc[r.city] = (acc[r.city] || 0) + 1
    return acc
  }, {})
  const topCities = (Object.entries(cityCounts) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const maxCityCount = topCities[0]?.[1] || 1

  // ── Verification health ──
  const supplierVerifPct = suppliersTotal > 0 ? Math.round((verifiedSuppliers / suppliersTotal) * 100) : 0
  const contractorVerifPct = contractorsTotal > 0 ? Math.round((verifiedContractors / contractorsTotal) * 100) : 0

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "New": return t("status_new")
      case "Awarded": return t("status_awarded")
      case "Completed": return t("status_completed")
      case "Draft": return t("status_draft")
      default: return status
    }
  }

  const formatTimeAgo = (ts: unknown) => {
    const ms = getTs(ts)
    if (!ms) return t("unknown_time")
    const diff = Date.now() - ms
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t("now")
    if (mins < 60) return t("minutes_ago", { mins })
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return t("hours_ago", { hrs })
    return t("days_ago", { days: Math.floor(hrs / 24) })
  }

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Suppliers */}
          <Link href="/admin/suppliers" className="block">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-purple-50">
                    <Users className="h-5 w-5 text-purple-600" />
                  </div>
                  {pendingSuppliers > 0 && (
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] shrink-0">
                      {pendingSuppliers} {t("pending_label")}
                    </Badge>
                  )}
                </div>
                <p className="text-3xl font-black text-foreground mb-0.5">{suppliersTotal}</p>
                <p className="text-sm text-muted-foreground mb-3">{t("total_suppliers")}</p>
                <div className="mt-auto space-y-1.5">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden" dir="ltr">
                    <div className="h-full bg-success rounded-full transition-all duration-700" style={{ width: `${supplierVerifPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-success font-semibold">{supplierVerifPct}% {t("verified_label")}</span>
                    <span className="text-muted-foreground tabular-nums">{verifiedSuppliers} / {suppliersTotal}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Contractors */}
          <Link href="/admin/contractors" className="block">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-blue-50">
                    <Building2 className="h-5 w-5 text-blue-600" />
                  </div>
                  {pendingContractors > 0 && (
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] shrink-0">
                      {pendingContractors} {t("pending_label")}
                    </Badge>
                  )}
                </div>
                <p className="text-3xl font-black text-foreground mb-0.5">{contractorsTotal}</p>
                <p className="text-sm text-muted-foreground mb-3">{t("total_contractors")}</p>
                <div className="mt-auto space-y-1.5">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden" dir="ltr">
                    <div className="h-full bg-cta rounded-full transition-all duration-700" style={{ width: `${contractorVerifPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-cta font-semibold">{contractorVerifPct}% {t("verified_label")}</span>
                    <span className="text-muted-foreground tabular-nums">{verifiedContractors} / {contractorsTotal}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* RFQ Pipeline */}
          <Link href="/admin/rfqs" className="block">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-success/10">
                    <FileText className="h-5 w-5 text-success" />
                  </div>
                  {mdmakDirectOrders > 0 && (
                    <Badge className="bg-accent/10 text-accent border-accent/20 text-[10px] gap-1 shrink-0">
                      <Handshake className="h-2.5 w-2.5" />
                      {mdmakDirectOrders}
                    </Badge>
                  )}
                </div>
                <p className="text-3xl font-black text-foreground mb-0.5">{publishedRfqs}</p>
                <p className="text-sm text-muted-foreground mb-3">{t("stat_total_rfqs")}</p>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full font-semibold">
                    {t("active_label")} {activeRfqs}
                  </span>
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                    {t("awarded_label")} {awardedRfqs}
                  </span>
                  <span className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                    {t("completed_label")} {completedRfqs}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Award Rate + Engagement */}
          <Card className="border-none shadow-sm h-full">
            <CardContent className="p-5 flex flex-col h-full">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2.5 rounded-xl bg-amber-50">
                  <Award className="h-5 w-5 text-amber-600" />
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {offersTotal} {t("offers_label")}
                </Badge>
              </div>
              <p className="text-3xl font-black text-foreground mb-0.5">
                {publishedRfqs > 0 ? `${awardRate}%` : "—"}
              </p>
              <p className="text-sm text-muted-foreground mb-3">{t("award_rate")}</p>
              <p className="mt-auto text-xs text-muted-foreground">
                {activeRfqs > 0 ? t("avg_per_rfq", { count: avgOffersPerRfq }) : t("no_data")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly RFQ Trend */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                {t("monthly_trend")}
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{t("monthly_trend_subtitle")}</Badge>
            </CardHeader>
            <CardContent className="p-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 10, right: 0, left: -22, bottom: 0 }} style={{ direction: 'ltr' }}>
                  <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  <Bar dataKey="rfqs" name={t("stat_active_rfqs")} fill="#0F172A" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* RFQ Status Distribution */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-accent" />
                {t("status_distribution")}
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {publishedRfqs} {t("rfq_count_suffix")}
              </Badge>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <div className="h-[200px] flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart style={{ direction: 'ltr' }}>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={78}
                        paddingAngle={pieData.length > 1 ? 3 : 0}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 min-w-[110px]">
                  {statusSegments.length > 0 ? statusSegments.map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <div>
                        <p className="text-[11px] text-muted-foreground leading-none mb-0.5">{d.name}</p>
                        <p className="text-sm font-black text-slate-800">{d.value}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground">{t("no_data")}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Insights Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Verification Health */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                {t("verification_health_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-purple-500" />
                    <span className="font-medium">{t("total_suppliers")}</span>
                  </div>
                  <span className="font-black text-foreground tabular-nums" dir="ltr">{verifiedSuppliers} / {suppliersTotal}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden" dir="ltr">
                  <div className="h-full bg-success rounded-full transition-all duration-700" style={{ width: `${supplierVerifPct}%` }} />
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] text-success font-semibold">{supplierVerifPct}% {t("verified_label")}</span>
                  {pendingSuppliers > 0 && (
                    <span className="text-[10px] text-amber-600 font-semibold">{pendingSuppliers} {t("pending_label")}</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-blue-500" />
                    <span className="font-medium">{t("total_contractors")}</span>
                  </div>
                  <span className="font-black text-foreground tabular-nums" dir="ltr">{verifiedContractors} / {contractorsTotal}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden" dir="ltr">
                  <div className="h-full bg-cta rounded-full transition-all duration-700" style={{ width: `${contractorVerifPct}%` }} />
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] text-cta font-semibold">{contractorVerifPct}% {t("verified_label")}</span>
                  {pendingContractors > 0 && (
                    <span className="text-[10px] text-amber-600 font-semibold">{pendingContractors} {t("pending_label")}</span>
                  )}
                </div>
              </div>

              {totalPending > 0 && (
                <div className="pt-2 border-t">
                  <Link href="/admin/suppliers">
                    <Button variant="outline" size="sm" className="w-full gap-2 text-amber-700 border-amber-200 hover:bg-amber-50 text-xs font-semibold">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {totalPending} {t("stat_pending_verification")}
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Cities */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {t("top_cities_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topCities.length > 0 ? (
                <div className="divide-y">
                  {topCities.map(([city, count], i) => (
                    <div key={city} className="flex items-center gap-3 px-5 py-3">
                      <span className="text-xs font-black text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{displayCity(city, locale)}</p>
                        <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${Math.round((count / maxCityCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0 font-bold tabular-nums">{count}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <MapPin className="mx-auto h-8 w-8 opacity-20 mb-2" />
                  <p className="text-sm">{t("no_city_data")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Verification Queue */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                {t("pending_verification")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingVerify && pendingVerify.length > 0 ? (
                <div className="divide-y">
                  {(pendingVerify as any[]).map((u: any) => (
                    <div key={u.id} className="px-5 py-3">
                      <p className="text-sm font-bold text-slate-800 truncate">{u.name || t("unknown_user")}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{u.role} · {u.email}</p>
                      <Link href={u.role === "Supplier" ? "/admin/suppliers" : "/admin/contractors"}>
                        <Button variant="link" size="sm" className="p-0 h-auto mt-1.5 text-xs text-primary font-bold">
                          {t("review_request")}
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <ShieldCheck className="mx-auto h-8 w-8 text-success opacity-60 mb-2" />
                  <p className="text-sm font-medium">{t("no_pending_requests")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity Feed */}
        <Card className="shadow-sm border-slate-100">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              {t("activity_feed")}
            </CardTitle>
            <Link href="/admin/rfqs">
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground h-7">
                {t("view_all")}
                <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentRfqs && recentRfqs.length > 0 ? (
              <div className="divide-y">
                {(recentRfqs as any[]).map((rfq: any) => (
                  <Link key={rfq.id} href={`/admin/rfqs/${rfq.id}`}>
                    <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50/80 transition-colors">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-bold text-slate-800 block truncate">{rfq.title || t("no_title")}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {rfq.city ? displayCity(rfq.city, locale) : t("uncategorized")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ms-3">
                        {rfq.orderedFromMdmakDirect && (
                          <Badge className="text-[10px] bg-accent/10 text-accent border-none gap-1 px-1.5 py-0.5">
                            <Handshake className="h-2.5 w-2.5" />
                          </Badge>
                        )}
                        <Badge
                          className={cn(
                            "text-[10px] border-none",
                            rfq.status === "New" && "bg-success/10 text-success",
                            rfq.status === "Awarded" && "bg-blue-50 text-blue-600",
                            rfq.status === "Completed" && "bg-purple-50 text-purple-700",
                            rfq.status === "Draft" && "bg-slate-100 text-slate-500",
                          )}
                        >
                          {getStatusLabel(rfq.status)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 whitespace-nowrap" suppressHydrationWarning>
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(rfq.createdAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground">
                <Activity className="mx-auto h-10 w-10 opacity-20 mb-2" />
                <p className="text-sm font-medium">{t("no_tenders")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
