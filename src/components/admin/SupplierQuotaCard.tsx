"use client"

// Admin → Settings: the free plan's monthly quotation allowance (supplier-approval.ts). Off by default — the owner's
// plan is to cap free suppliers (e.g. 30–40 a month) and sell more on a subscription; switching it on here applies it at
// once to every free supplier company, counted per Riyadh month. Read and written through /api/admin/supplier-quota.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Gauge, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { MAX_MONTHLY_QUOTES } from "@/lib/supplier-approval"

const DEFAULT_LIMIT = 30

export function SupplierQuotaCard() {
  const t = useTranslations("Portal.Admin.Settings")
  const { user } = useUser()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [on, setOn] = useState(false)
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT))

  useEffect(() => {
    if (!user) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch("/api/admin/supplier-quota", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
        const body = (await res.json().catch(() => null)) as { data?: { freeMonthlyQuotes?: number | null } } | null
        const n = body?.data?.freeMonthlyQuotes ?? null
        if (alive) {
          setOn(n != null)
          if (n != null) setLimit(String(n))
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  const n = Number(limit)
  const valid = !on || (Number.isInteger(n) && n >= 1 && n <= MAX_MONTHLY_QUOTES)

  const save = async () => {
    if (!user || !valid) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/supplier-quota", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ freeMonthlyQuotes: on ? n : null }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("quota_saved") })
    } catch {
      toast({ title: t("quota_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
            <Gauge size={16} className="text-primary" aria-hidden="true" />
          </span>
          {t("quota_title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">{t("quota_desc")}</p>
        {loading ? (
          <Loader2 size={18} className="animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="quota-on" className="font-semibold">
                {t("quota_switch")}
              </Label>
              <Switch id="quota-on" checked={on} onCheckedChange={setOn} />
            </div>
            {on && (
              <div className="space-y-1.5">
                <Label htmlFor="quota-limit" className="font-semibold">
                  {t("quota_limit_label")}
                </Label>
                <div className="flex items-center gap-3">
                  <Input id="quota-limit" type="number" inputMode="numeric" min={1} max={MAX_MONTHLY_QUOTES} value={limit} onChange={(e) => setLimit(e.target.value)} className="h-11 w-32 text-center font-bold" aria-invalid={!valid} />
                  <span className="text-sm text-muted-foreground">{t("quota_unit")}</span>
                </div>
                {!valid && <p className="text-xs text-destructive">{t("quota_invalid", { max: MAX_MONTHLY_QUOTES })}</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{on ? t("quota_on_note") : t("quota_off_note")}</p>
            <Button type="button" onClick={() => void save()} disabled={saving || !valid} className="gap-1.5">
              {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t("quota_save")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
