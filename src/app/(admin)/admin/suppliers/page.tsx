
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  Users, 
  Search, 
  ShieldCheck, 
  ShieldAlert, 
  MoreVertical,
  Filter,
  CheckCircle2,
  XCircle
} from "lucide-react"

export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState([
    { id: "S-1001", name: "المورد المتكامل", contact: "0501234567", category: "حديد ومعادن", verified: true, status: "نشط" },
    { id: "S-1002", name: "شركة النور للتوريدات", contact: "0502223334", category: "كهرباء", verified: false, status: "قيد المراجعة" },
    { id: "S-1003", name: "الشركة المتحدة للاسمنت", contact: "0504445556", category: "أسمنت وخرسانة", verified: true, status: "نشط" },
    { id: "S-1004", name: "مؤسسة البناء السريع", contact: "0507778889", category: "تشطيبات", verified: false, status: "موقوف" },
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
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة الموردين</h1>
            <p className="text-muted-foreground mt-1">التحقق من الموردين الجدد وإدارة حساباتهم</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="بحث باسم المورد..." className="pr-10" />
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
                <Users size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الموردين</p>
                <p className="text-2xl font-bold">2,450</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-success/5">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ShieldCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">موثقين</p>
                <p className="text-2xl font-bold">1,820</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-amber-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                <ShieldAlert size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">بانتظار التحقق</p>
                <p className="text-2xl font-bold">42</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">قائمة الموردين</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right hidden md:table-cell">المعرف</TableHead>
                  <TableHead className="text-right">اسم المورد</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">الفئة الرئيسية</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">التوثيق</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-mono text-xs hidden md:table-cell">{s.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{s.contact}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{s.category}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {s.verified ? (
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
                    <TableCell>{getStatusBadge(s.status)}</TableCell>
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
