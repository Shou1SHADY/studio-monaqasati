
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { History, Eye, Clock, CheckCircle2, XCircle, MoreVertical } from "lucide-react"

export default function SupplierOffersPage() {
  const offers = [
    { id: "OFF-101", rfqTitle: "توريد حديد سابك - مشروع النرجس", price: "45,000 ر.س", status: "قيد المراجعة", date: "2024-05-18" },
    { id: "OFF-098", rfqTitle: "خرسانة جاهزة K350", price: "12,500 ر.س", status: "مقبول", date: "2024-05-15" },
    { id: "OFF-095", rfqTitle: "أدوات سباكة - مجمع سكني", price: "8,200 ر.س", status: "مرفوض", date: "2024-05-10" },
    { id: "OFF-105", rfqTitle: "دهانات خارجية - فندق", price: "22,000 ر.س", status: "قيد المراجعة", date: "2024-05-20" },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">مقبول</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض</Badge>
      case "قيد المراجعة": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">عروضي المقدمة</h1>
          <p className="text-muted-foreground mt-1">تتبع حالة عروض السعر التي قمت بتقديمها للمقاولين</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض معلقة</p>
                <p className="text-xl font-bold text-slate-800">5</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض مقبولة</p>
                <p className="text-xl font-bold text-slate-800">38</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <XCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض مرفوضة</p>
                <p className="text-xl font-bold text-slate-800">12</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="text-primary" size={20} />
              سجل العروض
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">المعرف</TableHead>
                  <TableHead className="text-right">المناقصة</TableHead>
                  <TableHead className="text-right">السعر المقدم</TableHead>
                  <TableHead className="text-right">تاريخ التقديم</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow key={offer.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs">{offer.id}</TableCell>
                    <TableCell className="font-bold">{offer.rfqTitle}</TableCell>
                    <TableCell className="text-primary font-bold">{offer.price}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{offer.date}</TableCell>
                    <TableCell>{getStatusBadge(offer.status)}</TableCell>
                    <TableCell className="text-left">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon">
                          <Eye size={16} />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <MoreVertical size={16} />
                        </Button>
                      </div>
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
