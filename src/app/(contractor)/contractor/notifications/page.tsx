
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, MessageSquare, TrendingUp, CheckCircle2, Clock } from "lucide-react"

export default function ContractorNotificationsPage() {
  const notifications = [
    {
      id: 1,
      title: "عرض سعر جديد",
      description: "تلقيت عرض سعر جديد من 'المورد المتكامل' لمناقصة حديد التسليح.",
      time: "منذ 15 دقيقة",
      type: "offer",
      read: false
    },
    {
      id: 2,
      title: "اكتمال تقديم العروض",
      description: "انتهى الموعد النهائي لمناقصة 'أدوات سباكة'. يمكنك الآن مراجعة كافة العروض المقدمة.",
      time: "منذ 3 ساعات",
      type: "status",
      read: true
    },
    {
      id: 3,
      title: "تأكيد استلام الطلبية",
      description: "قام المورد بتأكيد استلامك للطلبية رقم ORD-5501.",
      time: "يوم أمس",
      type: "success",
      read: true
    }
  ]

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">مركز التنبيهات</h1>
            <p className="text-muted-foreground mt-1">ابقَ على اطلاع بحالة مناقصاتك وعروض الموردين</p>
          </div>
          <Button variant="ghost" size="sm">حذف الإشعارات القديمة</Button>
        </div>

        <div className="max-w-4xl space-y-3">
          {notifications.map((notif) => (
            <Card key={notif.id} className={`hover:shadow-md transition-shadow border-none ${notif.read ? 'opacity-80' : 'bg-white shadow-sm ring-1 ring-primary/10'}`}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                  notif.type === 'offer' ? 'bg-blue-50 text-blue-600' : 
                  notif.type === 'success' ? 'bg-success/10 text-success' : 'bg-slate-50 text-slate-500'
                }`}>
                  {notif.type === 'offer' && <MessageSquare size={24} />}
                  {notif.type === 'status' && <TrendingUp size={24} />}
                  {notif.type === 'success' && <CheckCircle2 size={24} />}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <p className="font-bold text-slate-900">{notif.title}</p>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock size={10} />
                      {notif.time}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{notif.description}</p>
                </div>
                {!notif.read && <div className="h-2 w-2 rounded-full bg-primary" />}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PortalLayout>
  )
}
