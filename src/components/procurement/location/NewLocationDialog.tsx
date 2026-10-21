"use client"

// «+ موقع جديد» (Procurement 2.0, ED-03 / ED-02): a delivery place added from where it is needed — the editor's group,
// the requester's «طلب مواد» — and picked at once. The name, the kind (work site | warehouse), the city (required), the
// district, the proposed receiver and a map link; the server saves it (`/api/procurement/delivery-sites`) and the
// caller gets the saved site back to select.

import { useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, MapPin, Plus, Warehouse } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { normaliseMapUrl } from "@/lib/procurement/delivery-site-input"
import type { DeliverySite } from "@/lib/procurement/delivery-sites"
import { saveDeliverySite } from "./saveDeliverySite"

const schema = z.object({
  name: z.string().trim().min(1, "name").max(120),
  kind: z.enum(["site", "warehouse"]),
  city: z.string().min(1, "city"),
  district: z.string().trim().max(80),
  receiverId: z.string(),
  mapUrl: z.string().refine((v) => !v.trim() || normaliseMapUrl(v) !== null, "map"),
})
type Values = z.infer<typeof schema>
const EMPTY: Values = { name: "", kind: "site", city: "", district: "", receiverId: "", mapUrl: "" }

export function NewLocationDialog({
  open,
  onOpenChange,
  orgId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  /** The saved site — to select it in the group (or the request) that asked for it. */
  onAdded: (site: DeliverySite) => void
}) {
  const t = useTranslations("Portal.ProcEditor")
  const locale = useLocale()
  const { toast } = useToast()
  const { receivers } = useProcReceivers(open ? orgId : null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const { register, control, handleSubmit, reset, setError, formState } = form
  const { errors, isSubmitting } = formState

  useEffect(() => {
    if (open) reset(EMPTY)
  }, [open, reset])

  const submit = handleSubmit(async (values) => {
    const result = await saveDeliverySite({
      kind: values.kind,
      name: values.name,
      city: values.city,
      district: values.district,
      receiverId: values.receiverId || null,
      mapUrl: values.mapUrl.trim() ? normaliseMapUrl(values.mapUrl) : null,
    })
    if ("error" in result) {
      if (result.error === "BAD_MAP_URL") setError("mapUrl", { message: "map" })
      else toast({ title: t(result.error === "FORBIDDEN" ? "newloc_err_forbidden" : "newloc_err_save"), variant: "destructive" })
      return
    }
    toast({ title: t("newloc_added", { name: result.site.name }) })
    onAdded(result.site)
    onOpenChange(false)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newloc_title")}</DialogTitle>
          <DialogDescription>{t("newloc_sub")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.stopPropagation()
            void submit(e)
          }}
          className="space-y-3"
          noValidate
        >
          <div className="space-y-1">
            <Label htmlFor="nl-name" className="text-xs">
              {t("newloc_name")} <span className="text-destructive">*</span>
            </Label>
            <Input id="nl-name" {...register("name")} placeholder={t("newloc_name_ph")} dir="auto" aria-invalid={!!errors.name || undefined} autoFocus />
            {errors.name && (
              <p className="text-[11px] font-semibold text-destructive" role="alert">
                {t("newloc_err_name")}
              </p>
            )}
          </div>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("newloc_kind")}>
                <Chip selected={field.value === "site"} icon={MapPin} onClick={() => field.onChange("site")}>
                  {t("newloc_kind_site")}
                </Chip>
                <Chip selected={field.value === "warehouse"} icon={Warehouse} onClick={() => field.onChange("warehouse")}>
                  {t("newloc_kind_warehouse")}
                </Chip>
              </div>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nl-city" className="text-xs">
                {t("newloc_city")} <span className="text-destructive">*</span>
              </Label>
              <NativeSelect id="nl-city" {...register("city")} className="w-full" aria-invalid={!!errors.city || undefined}>
                <option value="">{t("group_city_pick")}</option>
                {SAUDI_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {displayCity(c, locale)}
                  </option>
                ))}
              </NativeSelect>
              {errors.city && (
                <p className="text-[11px] font-semibold text-destructive" role="alert">
                  {t("newloc_err_city")}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nl-district" className="text-xs">
                {t("newloc_district")}
              </Label>
              <Input id="nl-district" {...register("district")} placeholder={t("newloc_district_ph")} dir="auto" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nl-receiver" className="text-xs">
                {t("newloc_receiver")}
              </Label>
              <NativeSelect id="nl-receiver" {...register("receiverId")} className="w-full">
                <option value="">{t("newloc_receiver_later")}</option>
                {receivers
                  .filter((r) => r.active !== false)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {r.title}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nl-map" className="text-xs">
                {t("newloc_map")} <span className="font-normal text-muted-foreground">{t("newloc_optional")}</span>
              </Label>
              <Input id="nl-map" {...register("mapUrl")} placeholder="maps.app.goo.gl/…" dir="ltr" aria-invalid={!!errors.mapUrl || undefined} />
              {errors.mapUrl && (
                <p className="text-[11px] font-semibold text-destructive" role="alert">
                  {t("newloc_err_map")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t("newloc_cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-1.5">
              {isSubmitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              {t("newloc_go")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
