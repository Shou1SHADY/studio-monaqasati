"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Link } from "@/i18n/routing"
import { 
  Users, 
  Package, 
  FileText, 
  Activity, 
  ShieldAlert,
  BarChart3,
  PieChart as PieChartIcon,
  Clock
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, limit } from "firebase/firestore"
import { useTranslations, useLocale } from 'next-intl'

export default function AdminDashboard() {
  const t = useTranslations("Portal.Admin.Dashboard")
  const locale = useLocale()
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

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

  // Pending verification requests (real data)
  const pendingVerifyQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users"),
      where("verificationRequested", "==", true),
      limit(5)
    )
  }, [firestore, user, isUserLoading])

  // Recent RFQs for activity feed
  const recentRfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "rfqs"),
      orderBy("createdAt", "desc"),
      limit(5)
    )
  }, [firestore, user, isUserLoading])

  const { data: rfqs } = useCollection(rfqsQuery)
  const { data: users } = useCollection(usersQuery)
  const { data: offers } = useCollection(offersQuery)
  const { data: pendingVerify } = useCollection(pendingVerifyQuery)
  const { data: recentRfqs } = useCollection(recentRfqsQuery)

  const suppliersCount = users?.filter((u: any) => u.role === "Supplier").length || 0;
  const contractorsCount = users?.filter((u: any) => u.role === "Contractor").length || 0;
  const activeRfqsCount = rfqs?.filter((r: any) => r.status === "New").length || 0;
  const offersCount = offers?.length || 0;

  const stats = [
    { title: t("total_suppliers"), value: suppliersCount.toString(), icon: Users, color: "text-purple-600", bg: "bg-purple-50" },
    { title: t("total_contractors"), value: contractorsCount.toString(), icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { title: t("active_tenders"), value: activeRfqsCount.toString(), icon: Package, color: "text-success", bg: "bg-success/10" },
    { title: t("price_offers"), value: offersCount.toString(), icon: FileText, color: "text-amber-600", bg: "bg-amber-50" },
  ]

  const days = [t("sunday"), t("monday"), t("tuesday"), t("wednesday"), t("thursday"), t("friday"), t("saturday")];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  rfqs?.forEach((rfq: any) => {
    if (rfq.createdAt) {
      const date = new Date(rfq.createdAt);
      dayCounts[date.getDay()]++;
    }
  });
  
  const barData = days.map((name, i) => ({ name, rfqs: dayCounts[i] }));

  const categoryCounts = rfqs?.reduce((acc: any, rfq: any) => {
    const cat = rfq.categoryId || t("other")
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {}) || {};

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#ef4444"];
  const dynamicPieData = Object.entries(categoryCounts).map(([name, value], i) => ({
    name,
    value,
    color: colors[i % colors.length]
  }));
  
  const pieData = dynamicPieData.length > 0 ? dynamicPieData : [{ name: t("no_data"), value: 1, color: "#cbd5e1" }];

  const formatTimeAgo = (isoString: string) => {
    if (!isoString) return t("unknown_time")
    const diff = Date.now() - new Date(isoString).getTime()
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
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("p-3 rounded-xl", stat.bg)}>
                    <stat.icon className={cn("h-6 w-6", stat.color)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* RFQs per Week Chart */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                {t("weekly_tenders")}
              </CardTitle>
              <Badge variant="secondary">{t("last_30_days")}</Badge>
            </CardHeader>
            <CardContent className="p-6 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }} style={{ direction: 'ltr' }}>
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="rfqs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Offers per Category Pie */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <PieChartIcon className="h-5 w-5 text-accent" />
                {t("offers_by_category")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart style={{ direction: 'ltr' }}>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Pending Verification Alerts — REAL data */}
          <Card className="lg:col-span-1 shadow-sm border-slate-100">
            <CardHeader className="border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                {t("pending_verification")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingVerify && pendingVerify.length > 0 ? (
                <div className="divide-y">
                  {(pendingVerify as any[]).map((u: any) => (
                    <div key={u.id} className="p-4 hover:bg-slate-50 transition-colors">
                      <p className="text-sm font-bold text-slate-800">{u.name || t("unknown_user")}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{u.role} — {u.email}</p>
                      <Link href={u.role === "Supplier" ? "/admin/suppliers" : "/admin/contractors"}>
                        <Button variant="link" size="sm" className="p-0 h-auto mt-2 text-primary font-bold">
                          {t("review_request")}
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <ShieldAlert className="mx-auto h-10 w-10 opacity-20 mb-2" />
                  <p className="text-sm font-medium">{t("no_pending_requests")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent RFQ Activity — REAL data */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100">
            <CardHeader className="border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                {t("activity_feed")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentRfqs && recentRfqs.length > 0 ? (
                <div className="divide-y">
                  {(recentRfqs as any[]).map((rfq: any) => (
                    <div key={rfq.id} className="p-4 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-bold text-slate-800 block">{rfq.title || t("no_title")}</span>
                        <span className="text-xs text-muted-foreground">{rfq.categoryId || t("uncategorized")}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs">{rfq.status || t("status_new")}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock size={11} />
                          {formatTimeAgo(rfq.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <Activity className="mx-auto h-10 w-10 opacity-20 mb-2" />
                  <p className="text-sm font-medium">{t("no_tenders")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}
