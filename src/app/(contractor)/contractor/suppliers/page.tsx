import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  MapPin, 
  Star, 
  ShieldCheck, 
  Filter, 
  ChevronLeft,
  Briefcase
} from "lucide-react"

export default function SuppliersDirectory() {
  const suppliers = [
    { 
      id: 1, 
      name: "المورد المتكامل", 
      verified: true, 
      rating: 4.8, 
      deals: 124, 
      city: "الرياض", 
      specs: ["حديد ومعادن", "أسمنت وخرسانة"] 
    },
    { 
      id: 2, 
      name: "الشركة المتحدة للتوريدات", 
      verified: true, 
      rating: 4.5, 
      deals: 86, 
      city: "جدة", 
      specs: ["أدوات صحية", "كهرباء"] 
    },
    { 
      id: 3, 
      name: "مؤسسة البناء الحديث", 
      verified: false, 
      rating: 4.2, 
      deals: 42, 
      city: "الدمام", 
      specs: ["أرضيات وتشطيبات"] 
    },
    { 
      id: 4, 
      name: "توريدات الخليج المميزة", 
      verified: true, 
      rating: 4.9, 
      deals: 210, 
      city: "الرياض", 
      specs: ["خرسانة جاهزة", "أسمنت"] 
    },
  ]

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">دليل الموردين</h1>
            <p className="text-muted-foreground mt-1">تصفح وتواصل مع أفضل الموردين المعتمدين في جميع المجالات</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="بحث باسم المورد..." className="pr-10" />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {suppliers.map((supplier) => (
            <Card key={supplier.id} className="hover:shadow-md transition-shadow overflow-hidden group border-slate-100 flex flex-col">
              <CardContent className="p-6 flex-1 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <Briefcase size={28} />
                  </div>
                  {supplier.verified && (
                    <Badge className="bg-blue-50 text-blue-600 border-none px-2 py-0.5 h-6">
                      <ShieldCheck size={14} className="ml-1" />
                      موثوق
                    </Badge>
                  )}
                </div>
                
                <div className="space-y-1">
                  <h3 className="font-bold text-lg text-slate-800">{supplier.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin size={14} />
                    <span>{supplier.city}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 py-2 border-y border-slate-50">
                  <div className="flex items-center gap-1">
                    <Star className="fill-amber-400 text-amber-400" size={16} />
                    <span className="font-bold text-slate-700">{supplier.rating}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-bold text-slate-700">{supplier.deals}</span> صفقة ناجحة
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2">
                  {supplier.specs.map(spec => (
                    <Badge key={spec} variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 px-2 font-normal">
                      {spec}
                    </Badge>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="p-0 border-t">
                <Button variant="ghost" className="w-full h-12 rounded-none hover:bg-primary hover:text-white transition-colors gap-2">
                  عرض الملف الشخصي
                  <ChevronLeft size={16} />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </PortalLayout>
  )
}
