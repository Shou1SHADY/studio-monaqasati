
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Shield, Bell, Globe, Handshake, Loader2, Percent, CheckCircle2 } from "lucide-react"
import { useTranslations, useLocale } from 'next-intl'
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { getCommissionRate, saveCommissionRate } from "@/lib/mdmak-procurement"
import { cn } from "@/lib/utils"

export default function AdminSettingsPage() {
  const t = useTranslations("Portal.Admin.Settings")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [commissionRate, setCommissionRate] = useState<number>(10)
  const [loadingRate, setLoadingRate] = useState(true)
  const [savingRate, setSavingRate] = useState(false)
  const [savedRate, setSavedRate] = useState(false)

  useEffect(() => {
    if (!firestore) return
    getCommissionRate(firestore)
      .then(r => setCommissionRate(r))
      .finally(() => setLoadingRate(false))
  }, [firestore])

  const handleSaveCommission = async () => {
    if (!firestore || !user || savingRate) return
    setSavingRate(true)
    try {
      await saveCommissionRate(firestore, commissionRate, user.uid)
      setSavedRate(true)
      toast({ title: t("commission_save_success") })
      setTimeout(() => setSavedRate(false), 2500)
    } catch {
      toast({ title: t("commission_save_error"), variant: "destructive" })
    } finally {
      setSavingRate(false)
    }
  }

  return (
    <PortalLayout>
      <div className={cn("max-w-4xl mx-auto py-8 space-y-8", locale === "ar" ? "text-right" : "text-left")}>
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("page_title")}</h1>
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
                  <Input defaultValue="support@mdmaktech.sa" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mdmak Procurement Settings */}
          <Card className="border-accent/20 shadow-sm bg-accent/[0.02]">
            <CardHeader className="border-b border-accent/10">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Handshake size={16} className="text-accent" />
                </div>
                {t("procurement_settings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <Label className="font-semibold flex items-center gap-1.5">
                  <Percent size={14} className="text-accent" />
                  {t("commission_rate_label")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("commission_rate_desc")}</p>
                <div className="flex items-center gap-3 mt-2">
                  {loadingRate ? (
                    <Loader2 size={18} className="animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={commissionRate}
                        onChange={e => setCommissionRate(parseFloat(e.target.value) || 0)}
                        className="h-11 w-36 rounded-xl text-center font-black text-lg border-accent/30 focus:border-accent"
                        placeholder={t("commission_rate_placeholder")}
                      />
                      <span className="text-sm font-bold text-muted-foreground">%</span>
                      <div className="flex gap-1.5">
                        {[5, 10, 15, 20].map(r => (
                          <button
                            key={r}
                            onClick={() => setCommissionRate(r)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                              commissionRate === r
                                ? "bg-accent text-white shadow-sm"
                                : "bg-muted text-muted-foreground hover:bg-accent/10 hover:text-accent"
                            )}
                          >
                            {r}%
                          </button>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSaveCommission}
                        disabled={savingRate}
                        className={cn(
                          "h-9 rounded-xl font-bold gap-1.5 transition-all",
                          savedRate
                            ? "bg-success text-white hover:bg-success/90"
                            : "bg-accent text-primary hover:bg-accent/90"
                        )}
                      >
                        {savingRate ? <Loader2 size={14} className="animate-spin" /> : savedRate ? <CheckCircle2 size={14} /> : null}
                        {savingRate ? t("save_settings") : savedRate ? t("commission_save_success") : t("save_settings")}
                      </Button>
                    </>
                  )}
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
      </div>
    </PortalLayout>
  )
}
