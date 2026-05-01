import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  Package, 
  Handshake, 
  Send, 
  DollarSign, 
  Search,
  ChevronLeft,
  Calendar
} from "lucide-react"
import Link from "next/link"

export default function SupplierDashboard() {
  const stats = [
    { title: "الطلبات النشطة", value: "12", icon: Package, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "عروض قيد الانتظار", value: "5", icon: Send, color: "text-amber-600", bg: "bg-amber-50" },
    { title: "عروض تم قبولها", value: "38", icon: Handshake, color: "text-success", bg: "bg-success/10" },
    { title: "إجمالي قيمة العقود", value: "450k", icon: DollarSign, color: "text-success", bg: "bg-success/10" },
  ]

  const recommendedRfqs = [
    { id: 'rfq-1', title: 'توريد حديد سابك - مشروع نيوم', category: 'حديد ومعادن', area: 'تبوك', deadline: '2024-06-15' },
    { id: 'rfq-2', title: 'خرسانة جاهزة K350 - عمارة تجارية', category: 'خرسانة جاهزة', area: 'الرياض', deadline: '2024-05-20' },
    { id: 'rfq-3', title: 'أدوات سباكة وإكسسوارات حمامات', category: 'أدوات صحية وسباكة', area: 'جدة', deadline: '2024-05-25' },
  ]

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">أهلاً بك، المورد المتكامل</h1>
          <p className="text-muted-foreground mt-1">إليك ملخص لنشاطك التجاري اليوم</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-none shadow-sm group hover:shadow-md transition-shadow">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recommended RFQs */}
          <Card className="lg:col-span-2 shadow-sm border-slate-100 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  <Search size={20} />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold">مناقصات مقترحة لك</CardTitle>
                  <p className="text-xs text-muted-foreground">بناءً على تخصصاتك ومناطق الخدمة</p>
                </div>
              </div>
              <Link href="/supplier/rfqs">
                <Button variant="outline" size="sm">تصفح الكل</Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recommendedRfqs.map((rfq) => (
                  <div key={rfq.id} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-3">
                        <h3 className="font-bold text-lg text-slate-800">{rfq.title}</h3>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-none px-3">{rfq.category}</Badge>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none px-3">{rfq.area}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar size={16} />
                          <span>الموعد النهائي: {rfq.deadline}</span>
                        </div>
                        <Button className="w-full md:w-auto bg-primary hover:bg-primary/90 rounded-full h-9 px-6 text-sm">
                          تقديم عرض سعر
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Profile Completion / Specializations */}
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold">تخصصاتك المسجلة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {['حديد ومعادن', 'أسمنت وخرسانة', 'خرسانة جاهزة'].map((spec) => (
                  <Badge key={spec} className="bg-success/10 text-success border-success/20 hover:bg-success/20 px-3 py-1">
                    {spec}
                  </Badge>
                ))}
              </div>
              <div className="h-px bg-slate-100" />
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-700">مناطق التغطية:</p>
                <div className="flex flex-wrap gap-2">
                  {['الرياض', 'المنطقة الشرقية', 'جدة'].map((area) => (
                    <span key={area} className="text-xs text-muted-foreground bg-slate-100 px-2 py-1 rounded">
                      {area}
                    </span>
                  ))}
                </div>
              </div>
              <Link href="/supplier/profile" className="block pt-4">
                <Button variant="ghost" className="w-full text-primary font-bold hover:bg-primary/5">
                  تعديل الملف الشخصي
                  <ChevronLeft className="mr-1 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ")
}
