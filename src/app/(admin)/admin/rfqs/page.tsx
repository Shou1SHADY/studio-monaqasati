
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  FileText, 
  Search, 
  Filter, 
  Calendar,
  MoreVertical,
  Activity,
  CheckCircle,
  Clock
} from "lucide-react"

export default function AdminRfqsPage() {
  const rfqs = [
    { id: "RFQ-701", title: "توريد أنابيب - مشروع نيوم", contractor: "شركة نيوم العالمية", status: "نشط", date: "2024-05-15", category: "أدوات صحية" },
    { id: "RFQ-702", title: "حديد تسليح - مول تجاري", contractor: "مقاولات الشرق", status: "نشط", date: "2024-05-16", category: "حديد ومعادن" },
    { id: "RFQ-685", title: "خرسانة جاهزة - فيلا سكنية", contractor: "إعمار نجد", status: "مكتمل", date: "2024-05-01", category: "أسمنت وخرسانة" },
    { id: "RFQ-705", title: "دهانات خارجية - مجمع مدارس", contractor: "شركة صيانة المدارس", status: "نشط", date: "2024-05-18", category: "دهانات" },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "نشط": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "مكتمل": return <Badge className="bg-blue-50 text-blue-600">مكتمل</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة المناقصات</h1>
            <p className="text-muted-foreground mt-1">مراقبة كافة المناقصات المطروحة على المنصة</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="بحث في المناقصات..." className="pr-10" />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Activity size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">نشطة حالياً</p>
                <p className="text-2xl font-bold">124</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <CheckCircle size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">تمت ترسيتها</p>
                <p className="text-2xl font-bold">856</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-500">
                <Clock size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">طلبات اليوم</p>
                <p className="text-2xl font-bold">18</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              كافة الطلبات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">المعرف</TableHead>
                  <TableHead className="text-right">المناقصة</TableHead>
                  <TableHead className="text-right">المقاول</TableHead>
                  <TableHead className="text-right">الفئة</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.map((rfq) => (
                  <TableRow key={rfq.id}>
                    <TableCell className="font-mono text-xs">{rfq.id}</TableCell>
                    <TableCell className="font-bold">{rfq.title}</TableCell>
                    <TableCell className="text-sm">{rfq.contractor}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">{rfq.category}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar size={14} />
                        {rfq.date}
                      </div>
                    </TableCell>
                    <TableCell className="text-left">
                      <Button variant="ghost" size="icon">
                        <MoreVertical size={18} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
