"use client"

// The fleet (سجل الأسطول) — HR's list of drivers and vehicles. A delivery note
// leaving the workshop picks its driver from here; nobody types a driver's
// name on the note (ORD-14). Everyone in the organization can read the list;
// keeping it is HR's (`employees.manage`). A vehicle is deactivated, never
// deleted, so every note that used it keeps its record.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, Lock, Pencil, Plus, Power, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import { FLEET_VEHICLES, saveFleetVehicle, type FleetVehicle } from "@/lib/manufacturing-writes"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"

const KINDS: Array<FleetVehicle["kind"]> = ["truck", "lorry", "van", "carrier"]

type Draft = { id?: string; driverName: string; plate: string; kind: FleetVehicle["kind"]; active: boolean }

export function FleetRegistry({ orgId, actor }: { orgId: string; actor: { id: string; name: string } }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canEdit = can("employees.manage")

  const fleetQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, FLEET_VEHICLES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(fleetQuery)
  const vehicles = useMemo(
    () =>
      ((data || []) as FleetVehicle[]).slice().sort((a, b) => {
        const act = (a.active === false ? 1 : 0) - (b.active === false ? 1 : 0)
        return act !== 0 ? act : a.driverName.localeCompare(b.driverName, locale)
      }),
    [data, locale]
  )

  const [draft, setDraft] = useState<Draft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = () => {
    setError(null)
    setDraft({ driverName: "", plate: "", kind: "truck", active: true })
  }
  const openEdit = (v: FleetVehicle) => {
    setError(null)
    setDraft({ id: v.id, driverName: v.driverName, plate: v.plate || "", kind: v.kind, active: v.active !== false })
  }

  const save = async () => {
    if (!firestore || !draft || saving || !orgId) return
    if (!draft.driverName.trim()) {
      setError(t("mfy_err_driver_required"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveFleetVehicle(firestore, {
        organizationId: orgId,
        vehicle: { id: draft.id, driverName: draft.driverName, plate: draft.plate || null, kind: draft.kind, active: draft.active },
        actor,
      })
      toast({ title: t(draft.id ? "mfy_fleet_updated" : "mfy_fleet_added") })
      setDraft(null)
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (v: FleetVehicle) => {
    if (!firestore || busyId) return
    setBusyId(v.id)
    const active = v.active === false
    try {
      await saveFleetVehicle(firestore, { organizationId: orgId, vehicle: { id: v.id, driverName: v.driverName, plate: v.plate, kind: v.kind, active }, actor })
      toast({ title: t(active ? "mfy_fleet_reactivated" : "mfy_fleet_deactivated") })
    } catch (err) {
      console.error(err)
      toast({ title: mfgActError(t, err), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3" dir={isRtl ? "rtl" : "ltr"} aria-labelledby="fleet-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 id="fleet-title" className="flex items-center gap-2 text-lg font-black text-primary">
            <Truck size={18} aria-hidden="true" />
            {t("mfy_fleet_title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("mfy_fleet_desc")}</p>
        </div>
        {canEdit ? (
          <Button variant="outline" className="shrink-0 gap-2" onClick={openNew} disabled={!orgId}>
            <Plus size={15} aria-hidden="true" />
            {t("mfy_fleet_add")}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={12} aria-hidden="true" />
            {t("mfy_fleet_read_only")}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={24} className="animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
          <Truck size={36} className="text-muted-foreground/20" aria-hidden="true" />
          <p className="font-bold text-muted-foreground">{t("mfy_fleet_empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground/80">{t("mfy_fleet_empty_hint")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-start font-bold text-muted-foreground">{t("mfy_fleet_driver")}</th>
                <th className="px-4 py-3 text-start font-bold text-muted-foreground">{t("mfy_fleet_plate")}</th>
                <th className="px-4 py-3 text-start font-bold text-muted-foreground">{t("mfy_fleet_kind")}</th>
                <th className="px-4 py-3 text-start font-bold text-muted-foreground">{t("mfy_fleet_status")}</th>
                {canEdit && <th className="w-24 px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, idx) => {
                const inactive = v.active === false
                return (
                  <tr key={v.id} className={cn(idx % 2 === 0 ? "bg-white" : "bg-muted/10", inactive && "text-muted-foreground")}>
                    <td className={cn("px-4 py-3 font-semibold", inactive ? "text-muted-foreground" : "text-primary")} dir="auto">{v.driverName}</td>
                    <td className="px-4 py-3 font-mono text-sm" dir="ltr">{v.plate || "—"}</td>
                    <td className="px-4 py-3">{t(`mfy_fleet_kind_${v.kind}`)}</td>
                    <td className="px-4 py-3">
                      <Badge className={cn("border-none text-[10px]", inactive ? "bg-muted text-muted-foreground" : "bg-success/10 text-success")}>
                        {t(inactive ? "mfy_fleet_inactive" : "mfy_fleet_active")}
                      </Badge>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-muted-foreground hover:text-primary"
                            onClick={() => openEdit(v)}
                            aria-label={t("mfy_fleet_edit_aria", { name: v.driverName })}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("h-9 w-9", inactive ? "text-muted-foreground hover:text-success" : "text-muted-foreground hover:text-destructive")}
                            onClick={() => toggleActive(v)}
                            disabled={busyId === v.id}
                            aria-label={t(inactive ? "mfy_fleet_reactivate_aria" : "mfy_fleet_deactivate_aria", { name: v.driverName })}
                          >
                            {busyId === v.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => { if (!open && !saving) setDraft(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>{t(draft.id ? "mfy_fleet_edit_title" : "mfy_fleet_add_title")}</DialogTitle>
                <DialogDescription>{t("mfy_fleet_dialog_desc")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="fleet-driver">
                    {t("mfy_fleet_driver")}
                    <span className="ms-0.5 text-destructive">*</span>
                  </Label>
                  <Input id="fleet-driver" dir="auto" value={draft.driverName} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fleet-plate">{t("mfy_fleet_plate")}</Label>
                    <Input id="fleet-plate" dir="ltr" value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fleet-kind">{t("mfy_fleet_kind")}</Label>
                    <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as FleetVehicle["kind"] })}>
                      <SelectTrigger id="fleet-kind"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {KINDS.map((k) => (
                          <SelectItem key={k} value={k}>{t(`mfy_fleet_kind_${k}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                  <div>
                    <Label htmlFor="fleet-active" className="text-sm font-bold">{t("mfy_fleet_active")}</Label>
                    <p className="text-[11px] text-muted-foreground">{t("mfy_fleet_active_hint")}</p>
                  </div>
                  <Switch id="fleet-active" checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} />
                </div>
                <SignedInAs name={actor.name} />
                {error && <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>{t("crm_cancel")}</Button>
                <Button onClick={save} disabled={saving} className="gap-2">
                  {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                  {t("mfy_fleet_save")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
