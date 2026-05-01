import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { 
  Users, 
  Package, 
  FileText, 
  Activity, 
  ShieldAlert,
  BarChart3,
  PieChart
} from "lucide-react"

export default function AdminDashboard() {
  const stats = [
    { title: "إجمالي الموردين", value: "2,450", icon: Users, color: "text-purple-600", bg: "bg-purple-50" },
    { title: "إجمالي المقاولين", value: "890", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "مناقصات نشطة", value: "312", icon: Package, color: "text-success", bg: "bg-success/10" },
    { title: "عروض السعر اليوم", value: "124", icon: FileText, color: "text-amber-600", bg: "bg-amber-50" },
  ]

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">لوحة التحكم الإدارية</h1>
          <p className="text-muted-foreground mt-1">نظرة شاملة على أداء المنصة ونشاط المستخدمين</p>
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
          {/* RFQs per Week Chart Placeholder */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                المناقصات المطروحة أسبوعياً
              </CardTitle>
              <Badge variant="secondary">آخر 30 يوم</Badge>
            </CardHeader>
            <CardContent className="p-10 flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-4 opacity-40">
                <BarChart3 size={64} />
                <p className="text-sm font-medium">سيتم عرض الرسم البياني للمناقصات هنا</p>
              </div>
            </CardContent>
          </Card>

          {/* Offers per Category Pie Placeholder */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <PieChart className="h-5 w-5 text-accent" />
                توزيع العروض حسب الفئة
              </CardTitle>
            </CardHeader>
            <CardContent className="p-10 flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-4 opacity-40">
                <PieChart size={64} />
                <p className="text-sm font-medium">سيتم عرض توزيع الفئات هنا</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Security / Verification Alerts */}
          <Card className="lg:col-span-1 shadow-sm border-slate-100">
            <CardHeader className="border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                تنبيهات الأمان والتحقق
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {[
                  { user: "مؤسسة البناء القوي", msg: "طلب تحقق جديد مرفق بسجل تجاري", type: "verify" },
                  { user: "مقاولات الشرق", msg: "هبوط مؤشر الالتزام إلى ما دون 50%", type: "warning" },
                ].map((alert, i) => (
                  <div key={i} className="p-4 hover:bg-slate-50 transition-colors">
                    <p className="text-sm font-bold text-slate-800">{alert.user}</p>
                    <p className="text-xs text-muted-foreground mt-1">{alert.msg}</p>
                    <Button variant="link" size="sm" className="p-0 h-auto mt-2 text-primary font-bold">اتخاذ إجراء</Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* User Activity Feed */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100">
            <CardHeader className="border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                سجل النشاط المباشر
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {[
                  { action: "سجل مورد جديد:", user: "شركة الإنارة المتطورة", time: "قبل دقيقتين" },
                  { action: "نشر مناقصة جديدة:", user: "مجموعة العمار", time: "قبل 15 دقيقة" },
                  { action: "ترسية عقد:", user: "المورد المتميز x مقاولات الرياض", time: "قبل ساعة" },
                ].map((act, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">{act.action} </span>
                      <span className="text-sm font-bold text-slate-800">{act.user}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{act.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}
