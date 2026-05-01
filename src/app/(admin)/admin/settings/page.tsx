
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Settings, Shield, Bell, Globe } from "lucide-react"

export default function AdminSettingsPage() {
  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-right space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">إعدادات المنصة</h1>
          <p className="text-muted-foreground mt-1">تخصيص القواعد العامة والتحكم في خصائص النظام</p>
        </div>

        <div className="grid gap-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe size={20} className="text-primary" />
                الإعدادات العامة
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>اسم المنصة</Label>
                  <Input defaultValue="مناقصتي" />
                </div>
                <div className="space-y-2">
                  <Label>بريد الدعم الفني</Label>
                  <Input defaultValue="support@munaqasati.sa" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield size={20} className="text-success" />
                قواعد التحقق والأمان
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">تطلب التحقق التلقائي للسجل التجاري</Label>
                  <p className="text-xs text-muted-foreground">ربط النظام بقاعدة بيانات وزارة التجارة للتحقق الفوري</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">منع المقاولين غير الموثقين من طرح مناقصات</Label>
                  <p className="text-xs text-muted-foreground">حصر طرح الطلبات على الحسابات التي أكملت التوثيق فقط</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell size={20} className="text-amber-500" />
                إعدادات الإشعارات
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">إرسال إشعارات البريد الإلكتروني</Label>
                  <p className="text-xs text-muted-foreground">تفعيل إرسال ملخص يومي للعمليات للمستخدمين</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline">إلغاء</Button>
          <Button className="px-8 font-bold">حفظ الإعدادات</Button>
        </div>
      </div>
    </PortalLayout>
  )
}
