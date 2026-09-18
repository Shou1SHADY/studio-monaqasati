"use client"

// The Manufacturing module's visual kit. Every Manufacturing screen is built
// from these pieces so the module reads as one product: the same panel, the
// same pill for the same state, the same banner for a block and the same
// "what will happen" list before a decision is confirmed.
//
// Colours are the site's tokens only. The module's identity colour is
// `warning` (the Manufacturing tile's accent); states use success / cta /
// accent / warning / destructive the same way everywhere else in the portal.

import { useMemo, type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Drill,
  Eye,
  Factory,
  Flame,
  Hammer,
  HardHat,
  Info,
  Layers,
  Loader2,
  Lock,
  PackageCheck,
  PaintBucket,
  PencilRuler,
  Scissors,
  Search,
  Sparkles,
  Truck,
  Wrench,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { sarLtr } from "@/lib/riyal"

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtQty(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function fmtMoney(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString("en-US")
}

/** A figure with the Riyal sign, for a number isolated with `dir="ltr"`: the
 * sign leads so it stands to the LEFT of the figure in both scripts. */
export function fmtSar(n: number | null | undefined): string {
  return sarLtr(fmtMoney(n))
}

/** Short day + month, Western digits in both locales (Arabic dates would
 * otherwise mix numeral systems inside one sentence). */
export function useMfgDate() {
  const locale = useLocale()
  const t = useTranslations("Portal.Shared")
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "short" })
    const today = new Date().toISOString().slice(0, 10)
    const dayDiff = (iso: string) =>
      Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000)
    return {
      today,
      short: (iso: string | null | undefined) => (iso ? fmt.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : t("mfg3_date_not_set")),
      /** "today", "tomorrow", "in 3 days", "2 days ago". */
      relative: (iso: string | null | undefined) => {
        if (!iso) return ""
        const d = dayDiff(iso)
        if (d === 0) return t("mfg3_rel_today")
        if (d === 1) return t("mfg3_rel_tomorrow")
        if (d === -1) return t("mfg3_rel_yesterday")
        return d > 0 ? t("mfg3_rel_in_days", { days: d }) : t("mfg3_rel_days_ago", { days: -d })
      },
      dayDiff,
    }
  }, [locale, t])
}

// ---------------------------------------------------------------------------
// Department icons — a department has a name, not an icon; the name says it
// ---------------------------------------------------------------------------

const DEPARTMENT_ICONS: Array<[RegExp, ElementType]> = [
  [/تصميم|رسم|design|draw|nest/i, PencilRuler],
  [/فرز|اعتماد|select|sign/i, Eye],
  [/قص|منشار|cut|saw/i, Scissors],
  [/حفر|تفريغ|drill|cut-?out/i, Drill],
  [/تشكيل|حواف|تجميع|edge|profil|assembl/i, Wrench],
  [/تلميع|معالجة|polish|seal|finish/i, Sparkles],
  [/دهان|طلاء|paint|coat/i, PaintBucket],
  [/لحام|weld/i, Flame],
  [/نجار|خشب|join|wood|carpent/i, Hammer],
  [/فحص|جودة|تغليف|qc|quality|pack|inspect/i, ClipboardCheck],
  [/تركيب|موقع|install|site/i, HardHat],
  [/شحن|تسليم|ship|deliver/i, Truck],
]

export function departmentIcon(name: string | null | undefined, onSite?: boolean): ElementType {
  if (onSite) return HardHat
  const hit = DEPARTMENT_ICONS.find(([re]) => re.test(name || ""))
  return hit ? hit[1] : Factory
}

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

export type MfgTone = "ok" | "warn" | "bad" | "info" | "accent" | "muted" | "mfg"

const PILL_TONE: Record<MfgTone, string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  bad: "bg-destructive/10 text-destructive",
  info: "bg-cta/10 text-cta",
  accent: "bg-accent/15 text-secondary",
  muted: "bg-muted text-muted-foreground",
  mfg: "bg-warning/10 text-warning",
}

export function MfgPill({ tone = "muted", icon: Icon, dot, children, className }: { tone?: MfgTone; icon?: ElementType; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", PILL_TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** A smaller, squarer chip for facts inside a card (lot, rush, blocked). */
export function MfgChip({ tone = "muted", icon: Icon, children, className }: { tone?: MfgTone; icon?: ElementType; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[10px] font-bold", PILL_TONE[tone], className)}>
      {Icon && <Icon size={10} aria-hidden="true" />}
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function MfgPanel({
  title,
  subtitle,
  count,
  action,
  icon: Icon,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  count?: number
  action?: ReactNode
  icon?: ElementType
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-3">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
              <Icon size={15} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            {title && <h3 className="text-sm font-bold text-foreground">{title}</h3>}
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="ms-auto flex items-center gap-2">
            {count != null && <span className="text-xs font-bold tabular-nums text-cta">{count}</span>}
            {action}
          </div>
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function MfgEmpty({ title, hint, icon: Icon = PackageCheck }: { title: string; hint?: string; icon?: ElementType }) {
  return (
    <div className="px-6 py-10 text-center">
      <Icon size={30} className="mx-auto mb-2 text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const NOTE_TONE: Record<"info" | "warn" | "bad" | "ok", { cls: string; icon: ElementType }> = {
  info: { cls: "border-cta/20 bg-cta/5 text-cta", icon: Info },
  warn: { cls: "border-warning/25 bg-warning/5 text-warning", icon: AlertTriangle },
  bad: { cls: "border-destructive/25 bg-destructive/5 text-destructive", icon: Lock },
  ok: { cls: "border-success/25 bg-success/5 text-success", icon: CheckCircle2 },
}

/** A banner that states a fact, and — when there is one — what clears it. */
export function MfgNote({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "bad" | "ok"
  icon?: ElementType
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const Icon = icon || NOTE_TONE[tone].icon
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs", NOTE_TONE[tone].cls, className)}>
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 leading-relaxed">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5 font-normal opacity-90" : "font-semibold")}>{children}</div>}
      </div>
    </div>
  )
}

export function MfgKpiCard({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  subTone = "muted",
  onClick,
}: {
  icon: ElementType
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  subTone?: MfgTone
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon size={14} aria-hidden="true" /> {label}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-foreground">{value}</span>
        {unit && <span className="text-xs font-semibold text-muted-foreground">{unit}</span>}
      </span>
      {sub && <MfgPill tone={subTone} className="mt-1.5 max-w-full whitespace-normal text-start">{sub}</MfgPill>}
    </>
  )
  const cls = "flex flex-col items-start rounded-2xl border bg-white p-4 text-start shadow-sm transition"
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export interface MfgSegmentItem<T extends string> {
  id: T
  label: string
  count?: number
}

export function MfgSegments<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<MfgSegmentItem<T>>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-0.5 rounded-xl bg-muted p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === it.id ? "bg-white text-foreground shadow-sm" : "text-slate-600 hover:text-foreground"
          )}
        >
          {it.label}
          {it.count != null && <span className={cn("text-[10px] font-bold tabular-nums", value === it.id ? "text-warning" : "text-muted-foreground")}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function MfgSearchField({ value, onChange, placeholder, className, id }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; id?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 ps-8 text-xs" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface QtySegment {
  key: "delivered" | "transit" | "ready" | "wip" | "held" | "scrap"
  value: number
}

const QTY_COLOR: Record<QtySegment["key"], string> = {
  delivered: "bg-success",
  transit: "bg-cta",
  ready: "bg-success/45",
  wip: "bg-warning",
  held: "bg-warning/45",
  scrap: "bg-destructive",
}

/** Where every unit of an order is, as one bar: delivered · in transit ·
 * ready · in production · held for QC · scrap. */
export function MfgQtyBar({ total, segments, className, label }: { total: number; segments: QtySegment[]; className?: string; label?: string }) {
  const t = Math.max(total, 1)
  return (
    <span className={cn("flex h-2 min-w-[90px] overflow-hidden rounded-full bg-muted", className)} role="img" aria-label={label}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.key} className={cn("h-full", QTY_COLOR[s.key])} style={{ width: `${Math.min(100, (s.value / t) * 100)}%` }} />
        ))}
    </span>
  )
}

export function MfgQtyLegend() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground">
      {(Object.keys(QTY_COLOR) as Array<QtySegment["key"]>).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-sm", QTY_COLOR[k])} aria-hidden="true" />
          {t(`mfg3_qty_${k}`)}
        </span>
      ))}
    </div>
  )
}

/** A thin load bar: green under two days' queue, amber above, red at the bottleneck. */
export function MfgLoadBar({ ratio, tone }: { ratio: number; tone: "ok" | "warn" | "bad" }) {
  return (
    <span className="block h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <span
        className={cn("block h-full rounded-full", tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-success")}
        style={{ width: `${Math.max(3, Math.min(100, ratio * 100))}%` }}
      />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function MfgField({ label, required, hint, error, htmlFor, children }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-bold text-slate-700">
        {label}
        {required && <span className="ms-0.5 text-warning">*</span>}
      </Label>
      {children}
      {error ? <p className="text-[11px] font-semibold text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Key/value review rows — the facts a decision is taken on. */
export function MfgReview({ rows }: { rows: Array<[ReactNode, ReactNode] | null | false | undefined | "" | 0> }) {
  const visible = rows.filter(Boolean) as Array<[ReactNode, ReactNode]>
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      {visible.map(([k, v], i) => (
        <div key={i} className="flex gap-3 border-b border-border/60 px-3.5 py-2.5 text-xs last:border-b-0">
          <span className="w-36 shrink-0 text-muted-foreground">{k}</span>
          <span className="min-w-0 font-semibold text-foreground">{v}</span>
        </div>
      ))}
    </div>
  )
}

/** "What will happen" — the consequences of confirming, stated before the click. */
export function MfgEffects({ items }: { items: Array<{ text: ReactNode; applies?: boolean } | null | false | undefined | "" | 0> }) {
  const t = useTranslations("Portal.Shared")
  const visible = items.filter(Boolean) as Array<{ text: ReactNode; applies?: boolean }>
  if (!visible.length) return null
  return (
    <div className="rounded-xl border bg-white px-3.5 py-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <Info size={13} aria-hidden="true" /> {t("mfg3_effects_title")}
      </p>
      <ul className="space-y-1">
        {visible.map((it, i) => (
          <li key={i} className={cn("flex items-start gap-2 text-xs", it.applies === false ? "text-muted-foreground" : "text-slate-700")}>
            {it.applies === false ? (
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <Check size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            )}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface MfgChoice<T extends string> {
  id: T
  icon?: ElementType
  title: string
  description?: string
  disabled?: boolean
}

export function MfgChoiceCards<T extends string>({ value, onChange, options, columns = 2 }: { value: T; onChange: (v: T) => void; options: Array<MfgChoice<T>>; columns?: 2 | 3 }) {
  return (
    <div role="radiogroup" className={cn("grid grid-cols-1 gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {options.map((o) => {
        const Icon = o.icon
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex flex-col gap-1 rounded-xl border-2 bg-white px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              on ? "border-warning bg-warning/5" : "border-border hover:border-slate-300"
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              {Icon && <Icon size={14} className={on ? "text-warning" : "text-muted-foreground"} aria-hidden="true" />}
              {o.title}
            </span>
            {o.description && <span className="text-[11px] leading-relaxed text-muted-foreground">{o.description}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The module's form: a header that says what is being decided, optional step
 * indicator, a body of facts and inputs, and a footer that states the one
 * blocking problem (if any) beside the confirm button.
 */
export function MfgFormModal({
  open,
  onClose,
  icon: Icon,
  title,
  subtitle,
  steps,
  step = 0,
  error,
  busy,
  confirmLabel,
  confirmTone = "default",
  onBack,
  onNext,
  onConfirm,
  size = "md",
  children,
}: {
  open: boolean
  onClose: () => void
  icon: ElementType
  title: string
  subtitle?: string
  steps?: string[]
  step?: number
  error?: string | null
  busy?: boolean
  confirmLabel?: string
  confirmTone?: "default" | "destructive"
  onBack?: () => void
  onNext?: () => void
  onConfirm?: () => void
  size?: "md" | "lg"
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const Next = isRtl ? ChevronLeft : ChevronRight
  const last = !steps || step >= steps.length - 1
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose() }}>
      <DialogContent
        dir={isRtl ? "rtl" : "ltr"}
        className={cn("flex max-h-[92vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden bg-slate-50 p-0", size === "lg" ? "max-w-3xl" : "max-w-xl")}
      >
        <div className="flex items-center gap-3 border-b bg-white px-5 py-4 pe-12">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
            <Icon size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-base font-bold">{title}</DialogTitle>
            {subtitle ? <DialogDescription className="text-[11px]">{subtitle}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </div>
        </div>
        {steps && steps.length > 1 && (
          <ol className="flex items-center gap-2 border-b bg-white px-5 pb-3">
            {steps.map((s, i) => (
              <li key={s} className={cn("flex flex-1 items-center gap-2 text-[11px] font-semibold", i === step ? "text-foreground" : "text-muted-foreground")}>
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                    i < step ? "bg-success/15 text-success" : i === step ? "bg-warning text-white" : "bg-muted text-muted-foreground"
                  )}
                >
                  {i < step ? <Check size={11} /> : i + 1}
                </span>
                <span className="truncate">{s}</span>
                {i < steps.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        )}
        <div className="min-w-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-wrap items-center gap-2 border-t bg-white px-5 py-3">
          {onBack && step > 0 && (
            <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
              {t("mfg3_back")}
            </Button>
          )}
          {error && (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} className="shrink-0" aria-hidden="true" /> <span className="truncate">{error}</span>
            </span>
          )}
          <div className="ms-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              {t("mfg3_cancel")}
            </Button>
            {last ? (
              <Button size="sm" variant={confirmTone === "destructive" ? "destructive" : "default"} onClick={onConfirm} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {confirmLabel || t("mfg3_confirm")}
              </Button>
            ) : (
              <Button size="sm" onClick={onNext} disabled={busy} className="gap-1.5">
                {t("mfg3_next")} <Next size={14} />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The side drawer: an order, a request or a product opened without leaving the list. */
export function MfgDrawer({
  open,
  onClose,
  icon: Icon = Layers,
  title,
  meta,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  icon?: ElementType
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const locale = useLocale()
  const t = useTranslations("Portal.Shared")
  const isRtl = locale === "ar"
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent
        side={isRtl ? "left" : "right"}
        dir={isRtl ? "rtl" : "ltr"}
        className="flex w-full flex-col gap-0 overflow-hidden bg-slate-50 p-0 sm:max-w-2xl [&>button]:hidden"
      >
        <div className="flex items-start gap-3 border-b bg-white px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base font-bold leading-snug">{title}</SheetTitle>
            <SheetDescription asChild>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">{meta}</div>
            </SheetDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("mfg3_close")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t bg-white px-5 py-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  )
}

/** A card inside a drawer — optionally collapsible. */
export function MfgSection({
  icon: Icon,
  title,
  right,
  children,
  collapsible,
  defaultOpen = true,
}: {
  icon?: ElementType
  title: ReactNode
  right?: ReactNode
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const header = (
    <>
      {Icon && <Icon size={14} className="text-muted-foreground" aria-hidden="true" />}
      <span>{title}</span>
      {right && <span className="ms-auto flex items-center gap-2 font-semibold">{right}</span>}
    </>
  )
  if (collapsible) {
    return (
      <details open={defaultOpen} className="group overflow-hidden rounded-xl border bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-border/60 px-3.5 py-2.5 text-xs font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
          {header}
          <ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        {children}
      </details>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5 text-xs font-bold text-slate-700">{header}</header>
      {children}
    </section>
  )
}

export function MfgStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white px-3.5 py-2.5">
      <span className="block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-base font-bold text-foreground">{value}</span>
      {sub && <span className="mt-0.5 block text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** A row inside a section: text on one side, figures/actions on the other. */
export function MfgRow({ children, right, className, onClick }: { children: ReactNode; right?: ReactNode; className?: string; onClick?: () => void }) {
  const cls = cn("flex w-full items-center gap-3 border-b border-border/60 px-3.5 py-2.5 text-start text-xs last:border-b-0", className)
  const inner = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
