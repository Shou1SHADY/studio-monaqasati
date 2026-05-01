
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, PlusCircle, MoreHorizontal, Calendar, Users } from "lucide-react"
import Link from "next/link"

export default function ContractorRfqsPage() {
  const rfqs = [
    { id: "RFQ-201", title: "توريد حديد سابك - مشروع النرجس", category: "حديد ومعادن", status: "نشط", date: "2024-05-10", offers: 5 },
    { id: "RFQ-202", title: "خرسانة جاهزة K350", category: "أسمنت وخرسانة", status: "مسودة", date: "2024-05-12", offers: 0 },
    { id: "RFQ-198", title: "أدوات سباكة - مجمع سكني", category: "أدوات صحية", status: "مكتمل", date: "2024-04-25", offers: 12 },
    { id: "RFQ-205", title: "دهانات داخلية - فيلا خاصة", category: "دهانات", status: "نشط", date: "2024-05-14", offers: 3 },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "نشط": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "مسودة": return <Badge variant="secondary">مسودة</Badge>
      case "مكتمل": return <Badge className="bg-blue-50 text-blue-600">مكتمل</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">مناقصاتي</h1>
            <p className="text-muted-foreground mt-1">إدارة ومتابعة طلبات عروض السعر الخاصة بك</p>
          </div>
          <Link href="/contractor/rfqs/new">
            <Button className="w-full sm:w-auto gap-2">
              <PlusCircle size={18} />
              طرح مناقصة جديدة
            </Button>
          </Link>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              قائمة المناقصات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">المعرف</TableHead>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right">الفئة</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">العروض</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.map((rfq) => (
                  <TableRow key={rfq.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs">{rfq.id}</TableCell>
                    <TableCell className="font-bold">{rfq.title}</TableCell>
                    <TableCell>{rfq.category}</TableCell>
                    <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar size={14} />
                        {rfq.date}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users size={14} className="text-primary" />
                        <span className="font-bold">{rfq.offers}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-left">
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal size={18} />
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
