
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Bell, ShieldAlert, UserPlus, FileWarning } from "lucide-react"

export default function AdminNotificationsPage() {
  const adminLogs = [
    { id: 1, event: "طلب توثيق جديد", user: "مؤسسة البناء القوي", time: "2024-05-20 14:30", status: "بانتظار المراجعة", type: "verify" },
    { id: 2, event: "تسجيل مقاول جديد", user: "شركة الإنشاءات المتميزة", time: "2024-05-20 12:15", status: "نشط", type: "register" },
    { id: 3, event: "تنبيه: محاولة دخول مشبوهة", user: "نظام الأمان", time: "2024-05-19 23:45", status: "تم الحظر", type: "security" },
    { id: 4, event: "بلاغ عن محتوى", user: "مناقصة رقم RFQ-701", time: "2024-05-19 18:20", status: "تحت التحقيق", type: "report" },
  ]

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">سجل التنبيهات الإدارية</h1>
          <p className="text-muted-foreground mt-1">مراقبة كافة الأحداث الهامة والطلبات التي تحتاج إجراءً إدارياً</p>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="text-primary" size={20} />
              قائمة الأحداث
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-right">الحدث</TableHead>
                  <TableHead className="text-right">المستخدم / المصدر</TableHead>
                  <TableHead className="text-right">الوقت</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-bold">{log.event}</TableCell>
                    <TableCell>{log.user}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.time}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">{log.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {log.type === 'verify' && <ShieldAlert size={16} className="text-amber-500" />}
                      {log.type === 'register' && <UserPlus size={16} className="text-success" />}
                      {log.type === 'security' && <ShieldAlert size={16} className="text-destructive" />}
                      {log.type === 'report' && <FileWarning size={16} className="text-primary" />}
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
