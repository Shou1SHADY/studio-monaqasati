"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  FileText, 
  Users, 
  Trophy, 
  Activity, 
  PlusCircle,
  ArrowUpRight,
  TrendingUp,
  History,
  Star,
  Award
} from "lucide-react"
import Link from "next/link"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"

export default function ContractorDashboard() {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("contractorId", "==", user.uid))
  }, [firestore, user, isUserLoading])

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
    if (!firestore || myRfqIds.length === 0) return null
    return query(collection(firestore, "offers"), where("rfqId", "in", myRfqIds.slice(0, 30)))
  }, [firestore, myRfqIds.join(",")])
  
  const { data: offersData } = useCollection(acceptedOffersQuery)
  
  const favoriteSupplierIds = new Set(
    offersData
      ?.filter((o: any) => o.status === "مقبول")
      .map((o: any) => o.supplierId) || []
  )

  const favoriteSuppliers = suppliers?.filter((s: any) => favoriteSupplierIds.has(s.id)) || [];
  const suppliersCount = favoriteSuppliers.length || 0;

  const stats = [
    { title: "المناقصات المفتوحة", value: activeRfqsCount.toString(), icon: FileText, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "عقود تم ترسيتها", value: awardedCount.toString(), icon: Trophy, color: "text-success", bg: "bg-success/10" },
    { title: "نسبة الالتزام", value: "98%", icon: Activity, color: "text-amber-600", bg: "bg-amber-50" },
    { title: "الموردين في المنصة", value: suppliersCount.toString(), icon: Users, color: "text-purple-600", bg: "bg-purple-50" },
  ]

  const recentActivity = [
    ...(rfqs?.slice(0, 3).map((r: any) => ({
      id: r.id, 
      type: "rfq", 
      text: `مناقصة '${r.title || 'غير محدد'}'`, 
      time: r.createdAt ? new Date(r.createdAt).toLocaleDateString('ar-SA') : 'الآن', 
      status: r.status || "جديد"
    })) || [])
  ]

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">أهلاً بك، شركة المقاولات الحديثة</h1>
            <p className="text-muted-foreground mt-1">نظرة عامة على نشاطك في المنصة اليوم</p>
          </div>
          <Link href="/contractor/rfqs/new">
            <Button className="bg-primary hover:bg-primary/90 shadow-md">
              <PlusCircle className="ml-2 h-5 w-5" />
              طرح مناقصة جديدة
            </Button>
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-none shadow-sm overflow-hidden group hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("p-3 rounded-xl", stat.bg)}>
                    <stat.icon className={cn("h-6 w-6", stat.color)} />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                آخر النشاطات
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">عرض الكل</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recentActivity.length > 0 ? recentActivity.map((activity) => (
                  <div key={activity.id} className="p-4 hover:bg-slate-50 transition-colors flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        {activity.type === 'offer' && <TrendingUp className="h-5 w-5 text-success" />}
                        {activity.type === 'rfq' && <FileText className="h-5 w-5 text-blue-500" />}
                        {activity.type === 'award' && <Trophy className="h-5 w-5 text-amber-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{activity.text}</p>
                        <p className="text-xs text-muted-foreground mt-1" suppressHydrationWarning>{activity.time}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-medium">
                      {activity.status}
                    </Badge>
                  </div>
                )) : (
                  <div className="p-10 text-center text-muted-foreground">لا توجد نشاطات حالياً.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commitment Score Banner */}
          <Card className="bg-secondary text-white shadow-lg overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-success" />
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Activity className="h-5 w-5 text-success" />
                مؤشر الالتزام
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-center py-4">
                <div className="relative h-32 w-32">
                  <svg className="h-full w-full" viewBox="0 0 100 100">
                    <circle 
                      className="text-white/10" 
                      strokeWidth="10" 
                      stroke="currentColor" 
                      fill="transparent" 
                      r="40" 
                      cx="50" 
                      cy="50" 
                    />
                    <circle 
                      className="text-success" 
                      strokeWidth="10" 
                      strokeDasharray="251.2" 
                      strokeDashoffset="25.12" 
                      strokeLinecap="round" 
                      stroke="currentColor" 
                      fill="transparent" 
                      r="40" 
                      cx="50" 
                      cy="50" 
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold">90%</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-center text-white/70 leading-relaxed">
                التزامك العالي بالمناقصات يعزز ثقة الموردين بك ويسهل حصولك على أفضل الأسعار.
              </p>
              <Button className="w-full bg-white text-secondary hover:bg-slate-100 font-bold h-11">
                كيف يتم الحساب؟
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Favorite Suppliers Section */}
        <div className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
              الموردون المفضلون (تعاملات سابقة)
            </h2>
            <Button variant="outline" size="sm">إدارة المفضلة</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {favoriteSuppliers && favoriteSuppliers.length > 0 ? favoriteSuppliers.slice(0, 3).map((supplier: any) => (
              <Card key={supplier.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 border-2 border-white shadow-sm">
                      <Users size={20} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-800 text-sm truncate">{supplier.companyName || supplier.name || "مورد معتمد"}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Award size={12} className="text-success" />
                        <span>سبق التعامل معه</span>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Badge variant="outline" className="text-[10px] bg-slate-50">حديد</Badge>
                        <Badge variant="outline" className="text-[10px] bg-slate-50">أسمنت</Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) : (
              <div className="col-span-3 p-8 text-center text-muted-foreground bg-slate-50 rounded-xl border border-dashed">
                لا يوجد موردين مفضلين حتى الآن. ستظهر هنا الشركات التي أتممت معها صفقات.
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ")
}
