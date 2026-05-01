
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  MapPin, 
  Calendar, 
  ChevronLeft, 
  Filter,
  Zap
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function AvailableRfqsPage() {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")

  const rfqs = [
    { id: "RFQ-501", title: "توريد أنابيب حرارية - مجمع سكني", category: "أدوات صحية", area: "الرياض - النرجس", deadline: "2024-06-05", contractor: "شركة الإعمار الحديثة" },
    { id: "RFQ-502", title: "حديد تسليح 12 ملم - 50 طن", category: "حديد ومعادن", area: "جدة - أبحر", deadline: "2024-05-30", contractor: "مقاولات الغربية" },
    { id: "RFQ-503", title: "خرسانة جاهزة مقاومة للكبريتات", category: "أسمنت وخرسانة", area: "الرياض - الملقا", deadline: "2024-06-10", contractor: "بنيان العقارية" },
    { id: "RFQ-504", title: "أطقم حمامات فاخرة - فندق 5 نجوم", category: "أدوات صحية", area: "مكة المكرمة", deadline: "2024-06-15", contractor: "شركة الحرمين" },
  ]

  const handleApply = (id: string) => {
    toast({
      title: "تقديم عرض سعر",
      description: `سيتم نقلك لصفحة تقديم العرض للمناقصة ${id}`,
    })
  }

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">المناقصات المتاحة</h1>
            <p className="text-muted-foreground mt-1">تصفح الفرص الجديدة المتاحة في السوق لمجالات تخصصك</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="بحث في المناقصات..." 
                className="pr-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية التخصصات
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {rfqs.map((rfq) => (
            <Card key={rfq.id} className="hover:shadow-md transition-all border-slate-100 overflow-hidden group">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className="p-6 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="bg-primary/5 text-primary border-none">{rfq.category}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{rfq.id}</span>
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-xl font-bold text-slate-800 group-hover:text-primary transition-colors">
                        {rfq.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">صاحب الطلب: {rfq.contractor}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 pt-2">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin size={16} className="text-muted-foreground" />
                        {rfq.area}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Calendar size={16} className="text-muted-foreground" />
                        الموعد النهائي: {rfq.deadline}
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50/50 p-6 flex items-center justify-center md:border-r border-t md:border-t-0 min-w-[200px]">
                    <Button 
                      onClick={() => handleApply(rfq.id)}
                      className="w-full md:w-auto gap-2 bg-primary hover:bg-primary/90 rounded-full h-11 px-8 shadow-sm"
                    >
                      تقديم عرض سعر
                      <ChevronLeft size={18} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PortalLayout>
  )
}
