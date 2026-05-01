
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  Building2, 
  Search, 
  ShieldCheck, 
  ShieldAlert, 
  MoreVertical,
  Filter,
  CheckCircle2,
  XCircle,
  FileText
} from "lucide-react"

export default function AdminContractorsPage() {
  const [contractors, setContractors] = useState([
    { id: "C-2001", name: "شركة المقاولات الحديثة", cr: "1010123456", rfqs: 12, verified: true, status: "نشط" },
    { id: "C-2002", name: "مجموعة العمار للتطوير", cr: "1010556677", rfqs: 45, verified: true, status: "نشط" },
    { id: "C-2003", name: "مؤسسة بناء المستقبل", cr: "2020889900", rfqs: 3, verified: false, status: "قيد المراجعة" },
    { id: "C-2004", name: "شركة الإنشاءات المتميزة", cr: "1010112233", rfqs: 0, verified: false, status: "موقوف" },
  ])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "نشط": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "قيد المراجعة": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة</Badge>
      case "موقوف": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">موقوف</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة المقاولين</h1>
            <p className="text-muted-foreground mt-1">مراقبة حسابات المقاولين والتحقق من أهليتهم</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="بحث باسم الشركة..." className="pr-10" />
            </div>
            <Button variant="outline" className="gap-2 shrink-0">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm bg-blue-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <Building2 size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المقاولين</p>
                <p className="text-2xl font-bold">890</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-success/5">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <FileText size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المناقصات المطروحة</p>
                <p className="text-2xl font-bold">4,120</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-amber-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                <ShieldAlert size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">طلبات توثيق جديدة</p>
                <p className="text-2xl font-bold">15</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">سجل المقاولين</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">المعرف</TableHead>
                  <TableHead className="text-right">اسم الشركة</TableHead>
                  <TableHead className="text-right">رقم السجل</TableHead>
                  <TableHead className="text-right">المناقصات</TableHead>
                  <TableHead className="text-right">التوثيق</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractors.map((c) => (
                  <TableRow key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-mono text-xs">{c.id}</TableCell>
                    <TableCell className="font-bold">{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.cr}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-bold">{c.rfqs}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.verified ? (
                        <div className="flex items-center gap-1 text-success text-xs font-medium">
                          <CheckCircle2 size={14} />
                          موثق
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground text-xs font-medium">
                          <XCircle size={14} />
                          غير موثق
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(c.status)}</TableCell>
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
