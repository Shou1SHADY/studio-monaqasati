
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Settings, Shield, Bell, Globe } from "lucide-react"
import { useTranslations, useLocale } from 'next-intl'

export default function AdminSettingsPage() {
  const t = useTranslations("Portal.Admin.Settings")
  const locale = useLocale()
  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-right space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">{t("page_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
        </div>

        <div className="grid gap-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe size={20} className="text-primary" />
                {t("general_settings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>{t("platform_name")}</Label>
                  <Input defaultValue={t("platform_name_default")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("support_email")}</Label>
                  <Input defaultValue="support@munaqasati.sa" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield size={20} className="text-success" />
                {t("security_rules")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">{t("auto_verify_label")}</Label>
                  <p className="text-xs text-muted-foreground">{t("auto_verify_desc")}</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">{t("block_unverified_label")}</Label>
                  <p className="text-xs text-muted-foreground">{t("block_unverified_desc")}</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell size={20} className="text-amber-500" />
                {t("notification_settings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">{t("email_notif_label")}</Label>
                  <p className="text-xs text-muted-foreground">{t("email_notif_desc")}</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline">{t("cancel")}</Button>
          <Button className="px-8 font-bold">{t("save_settings")}</Button>
        </div>
      </div>
    </PortalLayout>
  )
}
