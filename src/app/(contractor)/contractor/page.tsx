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
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc } from "firebase/firestore"

export default function ContractorDashboard() {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("contractorId", "==", user.uid))
  }, [firestore, user, isUserLoading])

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: profile } = useDoc(userDocRef)

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
    { title: "المناقصات المفتوحة", value: activeRfqsCount.toString(), icon: FileText, color: "text-blue-600", bg: "bg-blue-50", glow: "group-hover:shadow-[0_0_20px_rgba(37,99,235,0.2)]", gradient: "group-hover:from-blue-50 group-hover:to-blue-100/50" },
    { title: "عقود تم ترسيتها", value: awardedCount.toString(), icon: Trophy, color: "text-emerald-600", bg: "bg-emerald-50", glow: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]", gradient: "group-hover:from-emerald-50 group-hover:to-emerald-100/50" },
    { title: "نسبة الالتزام", value: "90%", icon: Activity, color: "text-amber-600", bg: "bg-amber-50", glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]", gradient: "group-hover:from-amber-50 group-hover:to-amber-100/50" },
    { title: "الموردين في المنصة", value: suppliersCount.toString(), icon: Users, color: "text-indigo-600", bg: "bg-indigo-50", glow: "group-hover:shadow-[0_0_20px_rgba(79,70,229,0.2)]", gradient: "group-hover:from-indigo-50 group-hover:to-indigo-100/50" },
  ]

  const recentActivity = [
    ...(rfqs?.slice(0, 3).map((r: any) => ({
      id: r.id, 
      type: "rfq", 
      text: `تم طرح مناقصة '${r.title || 'غير محدد'}'`, 
      time: r.createdAt ? new Date(r.createdAt).toLocaleDateString('ar-SA') : 'الآن', 
      status: r.status || "جديد"
    })) || [])
  ]

  return (
    <PortalLayout>
      <div className="space-y-8 text-right max-w-7xl mx-auto pb-10">
        {/* Animated Header Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-secondary to-slate-800 p-8 sm:p-10 text-white shadow-xl">
          <div className="absolute top-0 right-0 -mt-20 -mr-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl mix-blend-screen" />
          <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl mix-blend-screen" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                أهلاً بك، <span className="text-transparent bg-clip-text bg-gradient-to-l from-primary to-blue-400">{profile?.companyName || profile?.name || "شريكنا العزيز"}</span> ✨
              </h1>
              <p className="text-slate-200 text-lg font-medium max-w-xl leading-relaxed">
                لوحة التحكم الذكية الخاصة بك. تابع مناقصاتك، راقب أداءك، وقم بإدارة عروض الموردين بكل سهولة واحترافية.
              </p>
            </div>
            <Link href="/contractor/rfqs/new" className="shrink-0">
              <Button className="bg-white text-secondary hover:bg-slate-100 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5)] transition-all duration-300 h-12 px-6 rounded-xl font-bold text-base group">
                <PlusCircle className="ml-2 h-5 w-5 transition-transform group-hover:rotate-90" />
                طرح مناقصة جديدة
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className={`border-none shadow-sm overflow-hidden group hover:-translate-y-1 hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-white to-slate-50/50 ${stat.gradient}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("p-3.5 rounded-2xl transition-all duration-300", stat.bg, stat.glow)}>
                    <stat.icon className={cn("h-6 w-6", stat.color)} strokeWidth={2.5} />
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-300" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-500">{stat.title}</p>
                  <p className="text-3xl font-black text-slate-800 tracking-tight">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity */}
          <Card className="lg:col-span-2 shadow-md border-none overflow-hidden bg-white/60 backdrop-blur-xl">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-white/50 pb-4">
              <CardTitle className="text-lg font-black flex items-center gap-2 text-slate-800">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <History className="h-5 w-5 text-primary" />
                </div>
                آخر النشاطات
              </CardTitle>
              <Link href="/contractor/rfqs">
                <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 hover:bg-primary/5 font-bold">عرض السجل كاملاً</Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100/80">
                {recentActivity.length > 0 ? recentActivity.map((activity) => (
                  <div key={activity.id} className="p-5 hover:bg-slate-50/80 transition-colors flex items-center justify-between group cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-2xl bg-white border shadow-sm flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-300">
                        {activity.type === 'offer' && <TrendingUp className="h-5 w-5 text-emerald-500" />}
                        {activity.type === 'rfq' && <FileText className="h-5 w-5 text-blue-500" />}
                        {activity.type === 'award' && <Trophy className="h-5 w-5 text-amber-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800 group-hover:text-primary transition-colors">{activity.text}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                          <p className="text-[11px] font-medium text-slate-500" suppressHydrationWarning>{activity.time}</p>
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-bold px-3 py-1 rounded-full border-none">
                      {activity.status}
                    </Badge>
                  </div>
                )) : (
                  <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center">
                      <Activity className="h-8 w-8 text-slate-300" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">لا توجد نشاطات حالياً</p>
                      <p className="text-sm text-slate-500">قم بطرح مناقصة جديدة لبدء استقبال العروض.</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commitment Score Banner */}
          <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-secondary text-white shadow-2xl overflow-hidden relative border-none group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-success/20 rounded-full blur-[80px] -mr-20 -mt-20 transition-all duration-700 group-hover:bg-success/30 group-hover:scale-110" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -ml-20 -mb-20 transition-all duration-700 group-hover:bg-primary/30 group-hover:scale-110" />
            
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-success/40 via-success to-emerald-400" />
            
            <CardHeader className="relative z-10 pb-2">
              <CardTitle className="text-lg font-black flex items-center gap-2 text-white/90">
                <div className="p-2 rounded-lg bg-white/10 backdrop-blur-sm border border-white/5">
                  <Activity className="h-5 w-5 text-emerald-400" />
                </div>
                مؤشر الالتزام
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 relative z-10">
              <div className="flex items-center justify-center py-6">
                <div className="relative h-36 w-36 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]">
                  <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
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
                      className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] transition-all duration-1000 ease-out" 
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
                    <span className="text-4xl font-black tracking-tighter text-white">90<span className="text-xl text-emerald-400">%</span></span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-center text-white/80 leading-relaxed font-medium px-4">
                التزامك العالي بالمناقصات يعزز ثقتك في السوق ويسهل حصولك على <span className="text-emerald-400 font-bold">أفضل الأسعار</span>.
              </p>
              <Button className="w-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10 font-bold h-12 rounded-xl transition-all duration-300">
                كيف يتم الحساب؟
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
                الموردون المفضلون
              </h2>
              <p className="text-sm text-slate-500 mt-1">الشركات التي أتممت معها صفقات سابقة بنجاح</p>
            </div>
            <Link href="/contractor/suppliers">
              <Button variant="outline" className="rounded-xl font-bold bg-white hover:bg-slate-50 border-slate-200 shadow-sm">إدارة المفضلة</Button>
            </Link>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {favoriteSuppliers && favoriteSuppliers.length > 0 ? favoriteSuppliers.slice(0, 3).map((supplier: any) => (
              <Card key={supplier.id} className="border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 bg-white group rounded-2xl overflow-hidden">
                <div className="h-1.5 w-full bg-gradient-to-r from-slate-100 to-slate-200 group-hover:from-primary group-hover:to-blue-400 transition-colors duration-500" />
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-slate-400 shrink-0 border border-slate-200 shadow-sm group-hover:scale-110 transition-transform duration-300">
                      <Users size={24} />
                    </div>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <h3 className="font-black text-slate-800 text-base truncate group-hover:text-primary transition-colors">{supplier.companyName || supplier.name || "مورد معتمد"}</h3>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 w-fit px-2 py-1 rounded-md">
                        <Award size={14} className="text-amber-500" />
                        <span className="font-medium">سبق التعامل معه</span>
                      </div>
                      <div className="flex gap-2 pt-3 flex-wrap">
                        <Badge variant="outline" className="text-[10px] bg-white border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-md shadow-sm">مواد بناء</Badge>
                        <Badge variant="outline" className="text-[10px] bg-white border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-md shadow-sm">أسمنت</Badge>
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
                <h3 className="font-bold text-slate-700 text-lg">لا يوجد موردين مفضلين حتى الآن</h3>
                <p className="text-slate-500 max-w-md mt-2 leading-relaxed">
                  ستظهر هنا تلقائياً الشركات والموردين الذين قمت بترسية صفقات أو اعتماد عروضهم مسبقاً لسهولة الوصول إليهم مستقبلاً.
                </p>
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
