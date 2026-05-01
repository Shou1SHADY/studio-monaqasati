
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Bell, CheckCircle2, Info, AlertTriangle, Clock } from "lucide-react"

export default function SupplierNotificationsPage() {
  const notifications = [
    {
      id: 1,
      title: "مناقصة جديدة مطابقة لتخصصك",
      description: "تم طرح مناقصة جديدة 'توريد حديد سابك' في منطقة الرياض تتناسب مع تخصصاتك.",
      time: "منذ 10 دقائق",
      type: "info",
      read: false
    },
    {
      id: 2,
      title: "تم قبول عرض السعر",
      description: "تهانينا! تم قبول عرضك للمناقصة رقم RFQ-201. يمكنك الآن البدء في إجراءات التوريد.",
      time: "منذ ساعتين",
      type: "success",
      read: true
    },
    {
      id: 3,
      title: "تنبيه: اقتراب الموعد النهائي",
      description: "بقي أقل من 24 ساعة لتقديم عرضك لمناقصة 'أدوات صحية - مجمع الخبر'.",
      time: "منذ 5 ساعات",
      type: "warning",
      read: true
    }
  ]

  const getIcon = (type: string) => {
    switch (type) {
      case "success": return <CheckCircle2 className="text-success" />
      case "warning": return <AlertTriangle className="text-amber-500" />
      default: return <Info className="text-blue-500" />
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">الإشعارات</h1>
            <p className="text-muted-foreground mt-1">تابع آخر التحديثات والفرص المتاحة لك</p>
          </div>
          <Button variant="outline" size="sm">تحديد الكل كمقروء</Button>
        </div>

        <div className="space-y-4">
          {notifications.map((notif) => (
            <Card key={notif.id} className={`border-none shadow-sm transition-colors ${notif.read ? 'bg-white' : 'bg-blue-50/50 border-r-4 border-r-primary'}`}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
                  {getIcon(notif.type)}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">{notif.title}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {notif.time}
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{notif.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PortalLayout>
  )
}
