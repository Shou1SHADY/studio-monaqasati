"use client"

// The plumbing every order form shares: the order summary at the top (the
// facts a decision is taken on), number / text / choice inputs sized for a
// tablet on the shop floor, the evidence toggles, the station checklist, the
// submit cycle (busy → toast → close, or the write's own error), and who gets
// told. The forms themselves only say what is decided.

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ClipboardCheck, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { isQcStation, type DeptCapacityFields } from "@/lib/manufacturing-engine"
import { toggleChecklistItem } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks, type EventParams, type MfgEventKind, type RecipientSpec } from "@/lib/mfg-events"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi, type MfgUi } from "./MfgUiContext"
import { errorText, sourceNameOf } from "./MfgOrderBits"
import { MfgField, MfgReview, fmtQty, useMfgDate } from "./ui/MfgUi"

export type Tr = ReturnType<typeof useTranslations>

/** A station as the registry stores it — the lead / QC / gate fields included. */
export type Station = MfgDepartment & DeptCapacityFields

export function stationOf(ui: Pick<MfgUi, "data">, departmentId: string | null | undefined): Station | undefined {
  return departmentId ? (ui.data.departments.find((d) => d.id === departmentId) as Station | undefined) : undefined
}

export const num = (s: string): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export const optNum = (s: string): number | null => (s.trim() === "" ? null : num(s))

export const todayIso = (): string => new Date().toISOString().slice(0, 10)

/** Numbers never flip inside a sentence (UI-02). */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("tabular-nums", className)}>
      {children}
    </bdi>
  )
}

// ---------------------------------------------------------------------------
// Submit cycle
// ---------------------------------------------------------------------------

export function useSubmit(onClose: () => void) {
  const t = useTranslations("Portal.Shared")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  /** Runs the write; the toast title comes from its result. `keepOpen` leaves
   * the form up (a delivery note offers to print). */
  async function run<R>(fn: () => Promise<R>, done: (r: R) => string | null, keepOpen = false): Promise<R | undefined> {
    if (busy) return undefined
    setBusy(true)
    try {
      const r = await fn()
      const title = done(r)
      if (title) toast({ title })
      if (!keepOpen) onClose()
      return r
    } catch (err) {
      console.error(err)
      toast({ title: errorText(t, err), variant: "destructive" })
      return undefined
    } finally {
      setBusy(false)
    }
  }

  return { busy, tried, setTried, run }
}

// ---------------------------------------------------------------------------
// Who is told (NT-01) — best-effort, never undoes the decision
// ---------------------------------------------------------------------------

/** Boundary events from a form — recipients are resolved from the team's roles
 * by `emitMfgEvent`; the message is rendered in each reader's language. */
export function useNotify() {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const emit = (kind: MfgEventKind, to: RecipientSpec[], params: EventParams, orderId?: string | null, link?: string | null) => {
    if (!firestore) return
    void emitMfgEvent(firestore, {
      kind,
      copy: t,
      organizationId: ui.data.orgId,
      actor: ui.data.actor,
      to,
      params,
      workOrderId: orderId ?? null,
      link: link ?? (orderId ? mfgLinks.order(orderId) : mfgLinks.today()),
      departments: ui.data.departments,
    })
  }
  return {
    emit,
    managers: { permission: "manufacturing.manage" } as RecipientSpec,
    qc: { permission: "manufacturing.qc" } as RecipientSpec,
    cost: { permission: "manufacturing.cost" } as RecipientSpec,
    station: (departmentId: string | null | undefined): RecipientSpec => ({ station: departmentId }),
    users: (...ids: Array<string | null | undefined>): RecipientSpec => ({ users: ids }),
  }
}

/** Who owns an order outside the workshop: the requester, else the module's managers. */
export function ownerRecipients(view: OrderView): RecipientSpec[] {
  if (view.source === "stock") return []
  const out: RecipientSpec[] = []
  if (view.order.requestedByUserId) out.push({ users: [view.order.requestedByUserId] })
  else if (view.source === "client") out.push({ permission: "sales.manage" })
  else out.push({ permission: "rfq.manage" })
  if (view.source === "project" && view.order.projectId) out.push({ projectPermission: "projects.edit", projectId: view.order.projectId })
  return out
}

// ---------------------------------------------------------------------------
// The order summary heading every form (recHead)
// ---------------------------------------------------------------------------

export function OrderSummary({ view, extra }: { view: OrderView; extra?: Array<[ReactNode, ReactNode] | null | false> }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const c = view.calc
  return (
    <MfgReview
      rows={[
        [t("mfo_f_order"), <span key="o"><Num>{view.ref}</Num> — {view.product.name}</span>],
        [
          t("mfo_f_quantity"),
          <span key="q">
            <Num>{fmtQty(view.quantity)}</Num> {view.unit}
            {c.slice.shortfall > 0 && <span className="text-destructive"> · {t("mfg4_short_declared", { qty: fmtQty(c.slice.shortfall) })}</span>}
          </span>,
        ],
        [t("mfo_f_source"), [sourceNameOf(view, t), view.order.costItemName].filter(Boolean).join(" · ")],
        [t("mfg4_date_required"), view.neededBy ? `${d.short(view.neededBy)} · ${d.relative(view.neededBy)}` : t("mfg4_not_set")],
        ...(extra || []),
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function NumField({
  id,
  label,
  value,
  onChange,
  unit,
  hint,
  required,
  invalid,
  placeholder,
  action,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (v: string) => void
  unit?: string
  hint?: ReactNode
  required?: boolean
  invalid?: boolean
  placeholder?: string
  action?: ReactNode
}) {
  return (
    <MfgField label={label} required={required} hint={hint} htmlFor={id}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1" dir="ltr">
          <Input
            id={id}
            inputMode="decimal"
            dir="ltr"
            value={value}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
            className={cn("h-11 tabular-nums sm:h-10", unit && "pe-12", invalid && "border-destructive ring-1 ring-destructive")}
          />
          {unit && <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground">{unit}</span>}
        </div>
        {action}
      </div>
    </MfgField>
  )
}

export function TextField({ id, label, value, onChange, hint, required, placeholder, multiline }: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; required?: boolean; placeholder?: string; multiline?: boolean }) {
  return (
    <MfgField label={label} required={required} hint={hint} htmlFor={id}>
      {multiline ? (
        <Textarea id={id} dir="auto" value={value} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      ) : (
        <Input id={id} dir="auto" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-11 sm:h-10" />
      )}
    </MfgField>
  )
}

export function DateField({ id, label, value, onChange, hint, required }: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; required?: boolean }) {
  return (
    <MfgField label={label} required={required} hint={hint} htmlFor={id}>
      <Input id={id} type="date" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 sm:h-10" />
    </MfgField>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function SelectField({ id, label, value, onChange, options, placeholder, hint, required }: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; hint?: ReactNode; required?: boolean }) {
  const locale = useLocale()
  return (
    <MfgField label={label} required={required} hint={hint} htmlFor={id}>
      <Select value={value} onValueChange={onChange} dir={locale === "ar" ? "rtl" : "ltr"}>
        <SelectTrigger id={id} className="h-11 text-start text-sm sm:h-10">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </MfgField>
  )
}

/** Evidence or a confirmation, as a large tappable row (prototype `.ck`). */
export function CheckRow({ checked, onChange, title, hint, disabled, tone = "ok" }: { checked: boolean; onChange: (v: boolean) => void; title: ReactNode; hint?: ReactNode; disabled?: boolean; tone?: "ok" | "warn" }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-[44px] w-full items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-start text-xs transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        checked && (tone === "ok" ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")
      )}
    >
      <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2", checked ? "border-success bg-success text-white" : "border-slate-300 bg-white")}>
        {checked && <Check size={12} aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block font-bold text-foreground">{title}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// A station's checklist — non-blocking, signed and timed (FL-02)
// ---------------------------------------------------------------------------

export function canTickChecklist(ui: MfgUi, departmentId: string): boolean {
  const d = stationOf(ui, departmentId)
  if (!d) return false
  if (isQcStation(d)) return ui.perms.canQc
  // A station with a lead is that lead's alone (FL-13); an unowned one, its hands' and the manager's.
  if (d.leadUserId) return ui.perms.canWork && d.leadUserId === ui.data.actor.id
  return ui.perms.canWork || ui.perms.canManage
}

export function StationChecklist({ view, index }: { view: OrderView; index: number }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const [busy, setBusy] = useState<string | null>(null)
  const step = view.calc.route[index]
  const dept = stationOf(ui, step?.departmentId)
  if (!ui.data.settings.features.checklists || !step || !dept?.checklist?.length) return null
  const list = dept.checklist
  const marks = view.calc.slice.checklists?.[step.departmentId] || {}
  const count = list.filter((c) => marks[c.key]).length
  const allowed = canTickChecklist(ui, step.departmentId)
  const toggle = async (key: string) => {
    if (!firestore || busy || !allowed) return
    setBusy(key)
    try {
      await toggleChecklistItem(firestore, { orderId: view.id, departmentId: step.departmentId, itemKey: key, actor: ui.data.actor })
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(null)
    }
  }
  return (
    <MfgField
      label={
        <span className="flex items-center gap-1.5">
          <ClipboardCheck size={13} aria-hidden="true" />
          {t("mfo_checklist_of", { dept: dept.name })}
          <span className={cn("tabular-nums", count === list.length ? "text-success" : "text-warning")}>{t("mfo_count_of", { done: count, total: list.length })}</span>
        </span>
      }
      hint={count < list.length ? t("mfo_checklist_hint") : undefined}
    >
      <div className="space-y-1.5">
        {list.map((c) => {
          const m = marks[c.key]
          return (
            <button
              key={c.key}
              type="button"
              role="checkbox"
              aria-checked={!!m}
              disabled={!allowed || !!busy}
              onClick={() => void toggle(c.key)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-start text-xs transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                m && "border-success/40"
              )}
            >
              <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border-2", m ? "border-success bg-success text-white" : "border-slate-300")}>
                {busy === c.key ? <Loader2 size={11} className="animate-spin text-muted-foreground" /> : m ? <Check size={12} aria-hidden="true" /> : null}
              </span>
              <span className="flex-1 font-semibold">{c.label}</span>
              <span className="text-[10px] text-muted-foreground">{m ? `${m.by} · ${d.relative(m.at)}` : t("mfo_not_logged")}</span>
            </button>
          )
        })}
      </div>
    </MfgField>
  )
}
