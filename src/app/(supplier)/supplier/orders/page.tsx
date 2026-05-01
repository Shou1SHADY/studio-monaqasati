
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardList, Truck, PackageCheck, MapPin, MoreHorizontal } from "lucide-react"

export default function SupplierOrdersPage() {
  const orders = [
    { id: "ORD-5501", client: "شركة المقاولات الحديثة", product: "حديد تسليح 12ملم", amount: "10 طن", status: "جاري التوصيل", location: "الرياض - حي النرجس" },
    { id: "ORD-5482", client: "مؤسسة بناء الشمال", product: "أسمنت بورتلاندي", amount: "200 كيس", status: "تم التسليم", location: "جدة - أبحر الجنوبية" },
    { id: "ORD-5510", client: "شركة الإعمار", product: "خرسانة جاهزة", amount: "50 م3", status: "قيد التجهيز", location: "الرياض - الملقا" },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "جاري التوصيل": return <Badge className="bg-blue-50 text-blue-600 border-blue-100">جاري التوصيل</Badge>
      case "تم التسليم": return <Badge className="bg-success/10 text-success border-success/20">تم التسليم</Badge>
      case "قيد التجهيز": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد التجهيز</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">طلباتي (العقود)</h1>
            <p className="text-muted-foreground mt-1">إدارة الطلبات المؤكدة والعمليات اللوجستية</p>
          </div>
          <Button className="gap-2">
            <ClipboardList size={18} />
            تصدير تقرير
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-500">
                <PackageCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">بانتظار التجهيز</p>
                <p className="text-2xl font-bold">4</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Truck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">جاري توصيلها</p>
                <p className="text-2xl font-bold">8</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ClipboardList size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">مكتملة هذا الشهر</p>
                <p className="text-2xl font-bold">42</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">الطلبات النشطة</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">رقم الطلب</TableHead>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">المنتج والكمية</TableHead>
                  <TableHead className="text-right">الموقع</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs font-bold">{order.id}</TableCell>
                    <TableCell>{order.client}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{order.product}</span>
                        <span className="text-xs text-muted-foreground">{order.amount}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin size={12} />
                        {order.location}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
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
