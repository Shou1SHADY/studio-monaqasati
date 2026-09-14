"use client"

// The station registry (ST-01, FL-13). There is no global chain — a station
// enters a product's route from the product card (D3) — so this is a registry:
// each station's daily capacity (workers × hours), its hourly rate read from
// HR, its queue, its lead (a lead may own several stations), whether it is the
// QC & packing station (only Quality records its output) or an order-level
// step, and its non-blocking checklist. Deleting a station that holds work or
// sits on a product route is refused, naming the reason.

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore"
import { ClipboardCheck, Factory, PencilLine, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { MFG_DEPARTMENTS, type MfgDepartment } from "@/lib/manufacturing"
import { deptCapacity, isQcStation, stationGate, stationQueueDays, type DeptCapacityFields, type GateKind } from "@/lib/manufacturing-engine"
import { updateStation } from "@/lib/manufacturing-writes"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgRecordedAs } from "./MfgOrderBits"
import { MfgAnyModuleChip } from "./MfgSetReference"
import { reqErrorText } from "./MfgReqBits"
import { queueTone, stationUsage } from "./MfgPrdBits"
import { MfgChip, MfgEffects, MfgField, MfgFormModal, MfgNote, MfgPanel, MfgPill, departmentIcon, fmtMoney, fmtQty } from "./ui/MfgUi"

type Station = MfgDepartment & DeptCapacityFields

export function MfgSetStations() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney, world } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const canEdit = perms.canManage
  const timeOn = data.settings.features.time
  const stations = data.departments as Station[]

  const [editing, setEditing] = useState<Station | null>(null)
  const [creating, setCreating] = useState(false)
  const [refusal, setRefusal] = useState<{ name: string; ordersInHand: number; routes: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Station | null>(null)
  const [deleting, setDeleting] = useState(false)

  const usage = useMemo(() => new Map(stations.map((s) => [s.id, stationUsage(s.id, ui.views, data.products)])), [stations, ui.views, data.products])

  const askDelete = (s: Station) => {
    const u = stationUsage(s.id, ui.views, data.products)
    if (u.ordersInHand || u.routes) {
      setRefusal({ name: s.name, ...u })
      toast({ title: t("mfr_set_delete_refused", { name: s.name }), variant: "destructive" })
      return
    }
    setRefusal(null)
    setConfirmDelete(s)
  }

  const doDelete = async () => {
    if (!firestore || !confirmDelete || deleting) return
    const u = stationUsage(confirmDelete.id, ui.views, data.products)
    if (u.ordersInHand || u.routes) {
      setRefusal({ name: confirmDelete.name, ...u })
      setConfirmDelete(null)
      return
    }
    setDeleting(true)
    try {
      await deleteDoc(doc(firestore, MFG_DEPARTMENTS, confirmDelete.id))
      toast({ title: t("mfr_set_toast_deleted", { name: confirmDelete.name }) })
      setConfirmDelete(null)
    } catch (err) {
      console.error(err)
      toast({ title: reqErrorText(t, err), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <MfgPanel
      icon={Factory}
      title={t("mfr_set_registry_title")}
      subtitle={t("mfr_set_registry_sub")}
      count={stations.length}
      action={
        canEdit ? (
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" /> {t("mfr_set_new_station")}
          </Button>
        ) : undefined
      }
    >
      {stations.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("mfr_set_no_stations")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-start">{t("mfr_set_col_station")}</th>
                <th scope="col" className="px-3 py-2.5 text-start">{timeOn ? t("mfr_set_col_capacity") : t("mfr_set_workers")}</th>
                {timeOn && <th scope="col" className="px-3 py-2.5 text-start">{t("mfr_set_col_rate")}</th>}
                {timeOn && <th scope="col" className="px-3 py-2.5 text-start">{t("mfr_set_col_queue")}</th>}
                <th scope="col" className="px-3 py-2.5 text-start">{t("mfr_set_col_routes")}</th>
                {canEdit && <th scope="col" className="px-4 py-2.5 text-end"><span className="sr-only">{t("mfr_set_col_actions")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const u = usage.get(s.id) || { ordersInHand: 0, routes: 0 }
                const Icon = departmentIcon(s.name)
                const gate = stationGate(s)
                const qc = isQcStation(s)
                const lead = s.leadUserName || (s.leadUserId ? data.team.find((m) => m.id === s.leadUserId)?.name : null)
                const days = stationQueueDays(world.calcs, s, world.lost)
                return (
                  <tr key={s.id} className="border-b border-border/60 align-middle last:border-b-0">
                    <th scope="row" className="px-4 py-2.5 text-start font-normal">
                      <span className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                          <Icon size={15} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1 font-bold text-foreground">
                            <span dir="auto">{s.name}</span>
                            {qc && <MfgChip tone="ok" icon={ClipboardCheck}>{t("mfr_set_qc_chip")}</MfgChip>}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {gate && `${t("mfr_prd_order_level_step")} · `}
                            <span className={cn(u.ordersInHand > 0 && "font-semibold text-warning")}>{u.ordersInHand > 0 ? t("mfr_set_in_hand", { count: u.ordersInHand }) : t("mfr_set_idle")}</span>
                            {lead ? ` · ${lead}` : qc ? ` · ${t("mfg4_persona_qc")}` : ` · ${t("mfr_set_no_lead")}`}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-2.5">
                      {timeOn ? (
                        <span>
                          <b className="tabular-nums text-foreground">{t("mfr_set_capacity_value", { hours: fmtQty(deptCapacity(s)) })}</b>
                          <span className="ms-1.5 text-[11px] text-muted-foreground" dir="ltr">
                            {fmtQty(Number(s.workers) || 1)}×{fmtQty(Number(s.hoursPerDay) || 8)}
                          </span>
                        </span>
                      ) : (
                        <b className="tabular-nums text-foreground">{fmtQty(Number(s.workers) || 1)}</b>
                      )}
                    </td>
                    {timeOn && (
                      <td className="px-3 py-2.5">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {seesMoney ? (
                            <span dir="ltr" className="tabular-nums text-foreground">
                              {s.hourlyRate == null ? "—" : `${fmtMoney(s.hourlyRate)} ﷼`}
                            </span>
                          ) : (
                            <span aria-hidden="true">•••</span>
                          )}
                          <HrChip />
                        </span>
                      </td>
                    )}
                    {timeOn && (
                      <td className="px-3 py-2.5">
                        {gate ? <span className="text-muted-foreground">—</span> : <MfgPill tone={queueTone(days)}>{t("mfr_set_queue_days", { days: fmtQty(days) })}</MfgPill>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{t("mfr_set_in_routes", { count: u.routes })}</td>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        <span className="flex items-center justify-end gap-0.5">
                          <IconButton label={t("mfr_set_edit_station", { name: s.name })} onClick={() => setEditing(s)}>
                            <PencilLine size={14} aria-hidden="true" />
                          </IconButton>
                          <IconButton label={t("mfr_set_delete_station", { name: s.name })} tone="bad" onClick={() => askDelete(s)}>
                            <Trash2 size={14} aria-hidden="true" />
                          </IconButton>
                        </span>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 border-t border-border/60 px-4 py-3">
        {refusal && (
          <MfgNote tone="bad" title={t("mfr_set_delete_refused", { name: refusal.name })}>
            {[refusal.ordersInHand > 0 ? t("mfr_set_refused_orders", { count: refusal.ordersInHand }) : null, refusal.routes > 0 ? t("mfr_set_refused_routes", { count: refusal.routes }) : null]
              .filter(Boolean)
              .join(" ")}
          </MfgNote>
        )}
        <MfgNote tone="warn">{t("mfr_set_delete_rule")}</MfgNote>
      </div>

      {confirmDelete && (
        <MfgFormModal
          open
          onClose={() => setConfirmDelete(null)}
          icon={Trash2}
          title={t("mfr_set_delete_title", { name: confirmDelete.name })}
          busy={deleting}
          confirmTone="destructive"
          confirmLabel={t("mfr_set_delete_confirm")}
          onConfirm={doDelete}
        >
          <MfgEffects items={[{ text: t("mfr_set_delete_free") }, { text: t("mfr_set_delete_effect") }]} />
          <MfgRecordedAs />
        </MfgFormModal>
      )}
      {editing && <StationForm station={editing} onClose={() => setEditing(null)} />}
      {creating && <StationForm onClose={() => setCreating(false)} />}
    </MfgPanel>
  )
}

function HrChip() {
  return <MfgAnyModuleChip module="hr" prefix="from" />
}

// ---------------------------------------------------------------------------
// New station / edit a station
// ---------------------------------------------------------------------------

type GateChoice = "none" | GateKind

function StationForm({ station, onClose }: { station?: Station; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [name, setName] = useState(station?.name || "")
  const [workers, setWorkers] = useState(String(station?.workers ?? 2))
  const [hours, setHours] = useState(String(station?.hoursPerDay ?? 8))
  const [leadId, setLeadId] = useState<string>(station?.leadUserId || "none")
  const [qc, setQc] = useState(station ? isQcStation(station) : false)
  const [gate, setGate] = useState<GateChoice>(station ? stationGate(station) || "none" : "none")
  const [checklist, setChecklist] = useState<Array<{ key: string; label: string }>>(station?.checklist || [])
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const leads = data.team.filter((m) => m.work)
  const w = Number(workers)
  const h = Number(hours)
  const capacityOk = w >= 1 && h >= 1 && h <= 24

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    if (!name.trim()) return setError(t("mfr_set_err_name"))
    if (!capacityOk) return setError(t("mfr_set_err_capacity"))
    setError(null)
    setBusy(true)
    try {
      if (station) {
        const lead = leadId === "none" ? null : data.team.find((m) => m.id === leadId) || null
        await updateStation(firestore, station.id, {
          name: name.trim(),
          workers: Math.round(w),
          hoursPerDay: h,
          leadUserId: lead?.id ?? null,
          leadUserName: lead?.name ?? null,
          qcStation: qc,
          gate: gate === "none" ? null : gate,
          checklist: checklist.map((c) => ({ key: c.key, label: c.label.trim() })).filter((c) => c.label),
        })
        toast({ title: t("mfr_set_toast_saved", { name: name.trim() }) })
      } else {
        const order = data.departments.reduce((m, d) => Math.max(m, Number(d.order) || 0), 0) + 1
        await addDoc(collection(firestore, MFG_DEPARTMENTS), {
          organizationId: data.orgId,
          name: name.trim(),
          order,
          workers: Math.round(w),
          hoursPerDay: h,
          hourlyRate: null,
          // gate and qcStation are left unset: the station name is read until the manager sets them.
          leadUserId: null,
          leadUserName: null,
          checklist: [],
          createdByUserId: data.actor.id,
          createdByUserName: data.actor.name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        toast({ title: t("mfr_set_toast_station_added", { name: name.trim() }) })
      }
      onClose()
    } catch (err) {
      console.error(err)
      const msg = reqErrorText(t, err)
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Factory}
      title={station ? t("mfr_set_edit_title", { name: station.name }) : t("mfr_set_new_title")}
      subtitle={t("mfr_set_form_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={station ? t("mfr_set_save") : t("mfr_set_add")}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_100px_100px]">
        <MfgField label={t("mfr_set_station_name")} required htmlFor="mfr-station-name" error={attempted && !name.trim() ? t("mfr_set_err_name") : undefined}>
          <Input id="mfr-station-name" dir="auto" value={name} placeholder={t("mfr_set_station_name_ph")} onChange={(e) => setName(e.target.value)} className="h-10" />
        </MfgField>
        <MfgField label={t("mfr_set_workers")} htmlFor="mfr-station-workers">
          <Input id="mfr-station-workers" type="number" inputMode="numeric" min={1} dir="ltr" value={workers} onChange={(e) => setWorkers(e.target.value)} className="h-10 tabular-nums" aria-invalid={attempted && !capacityOk} />
        </MfgField>
        <MfgField label={t("mfr_set_hours_day")} htmlFor="mfr-station-hours">
          <Input id="mfr-station-hours" type="number" inputMode="decimal" min={1} max={24} dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} className="h-10 tabular-nums" aria-invalid={attempted && !capacityOk} />
        </MfgField>
      </div>
      <MfgNote tone="info">
        {t("mfr_set_capacity_note", { hours: fmtQty(capacityOk ? w * h : 0) })}
        {station?.hourlyRate != null && <> · {t("mfr_set_rate_now", { rate: fmtMoney(station.hourlyRate) })}</>}
      </MfgNote>

      {station && (
        <>
          <MfgField label={t("mfr_set_lead")} hint={t("mfr_set_lead_hint")}>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger className="h-10 text-xs" aria-label={t("mfr_set_lead")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  {t("mfr_set_no_lead_option")}
                </SelectItem>
                {leads.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MfgField>

          <div className="flex items-start justify-between gap-3 rounded-xl border bg-white px-3.5 py-3">
            <div className="min-w-0">
              <Label htmlFor="mfr-station-qc" className="text-xs font-bold text-slate-700">
                {t("mfr_set_qc_label")}
              </Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mfr_set_qc_hint")}</p>
            </div>
            <Switch id="mfr-station-qc" checked={qc} onCheckedChange={setQc} />
          </div>

          <MfgField label={t("mfr_set_gate_label")} hint={t("mfr_set_gate_hint")}>
            <Select value={gate} onValueChange={(v) => setGate(v as GateChoice)}>
              <SelectTrigger className="h-10 text-xs" aria-label={t("mfr_set_gate_label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  {t("mfr_set_gate_none")}
                </SelectItem>
                <SelectItem value="drawing" className="text-xs">
                  {t("mfr_set_gate_drawing")}
                </SelectItem>
                <SelectItem value="slab" className="text-xs">
                  {t("mfr_set_gate_slab")}
                </SelectItem>
              </SelectContent>
            </Select>
          </MfgField>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-700">{t("mfr_set_checklist")}</p>
            <p className="text-[11px] text-muted-foreground">{data.settings.features.checklists ? t("mfr_set_checklist_hint") : t("mfr_set_checklist_off")}</p>
            {checklist.map((c, i) => (
              <div key={c.key} className="flex items-center gap-1.5">
                <Input
                  dir="auto"
                  value={c.label}
                  aria-label={t("mfr_set_checklist_item", { n: i + 1 })}
                  onChange={(e) => setChecklist((rows) => rows.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))}
                  className="h-10 text-xs"
                />
                <IconButton label={t("mfr_set_checklist_remove", { n: i + 1 })} tone="bad" onClick={() => setChecklist((rows) => rows.filter((x) => x.key !== c.key))}>
                  <X size={14} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5 text-xs" onClick={() => setChecklist((rows) => [...rows, { key: `c_${Date.now().toString(36)}_${rows.length}`, label: "" }])}>
              <Plus size={14} aria-hidden="true" /> {t("mfr_set_checklist_add")}
            </Button>
          </div>
        </>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

function IconButton({ label, onClick, tone, children }: { label: string; onClick: () => void; tone?: "bad"; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "bad" ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
