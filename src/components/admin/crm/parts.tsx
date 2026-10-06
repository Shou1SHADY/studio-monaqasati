"use client"

import type { LucideIcon } from "lucide-react"
import { useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { formatAmount, formatCrmDate } from "@/lib/admin-crm"
import { sarLtr, sarRtl } from "@/lib/riyal"

/** A number card. With `onClick` it is a button that applies the matching filter. */
export function CrmKpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "warning" | "danger" | "success"
  onClick?: () => void
  active?: boolean
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          tone === "warning" ? "bg-warning/10 text-warning" : tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
        )}
        aria-hidden="true"
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 text-start">
        <span className="block truncate text-xs font-semibold text-muted-foreground">{label}</span>
        <span className={cn("block text-lg font-black tabular-nums", tone === "danger" ? "text-destructive" : "text-foreground")} dir="ltr">
          {value}
        </span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </>
  )
  const cls = cn("flex items-center gap-3 rounded-xl border bg-card p-4", active && "border-primary ring-1 ring-primary")
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(cls, "w-full transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** One date format everywhere (ADM-11): «21 أكتوبر 2026». */
export function CrmDate({ value, className }: { value: number | string | null | undefined; className?: string }) {
  const locale = useLocale()
  return <span className={className}>{formatCrmDate(value, locale)}</span>
}

/** Riyals with the official symbol on the left of the figure in both scripts. */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const locale = useLocale()
  const figure = formatAmount(amount)
  return (
    <span className={cn("tabular-nums", className)} dir="ltr">
      {locale === "ar" ? sarRtl(figure) : sarLtr(figure)}
    </span>
  )
}

/** Phone / e-mail: always left-to-right, on one line, cut short with the whole value on hover (ADM-11). */
export function LtrValue({ value, className }: { value: string; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <bdi dir="ltr" title={value} className={cn("block max-w-full truncate", className)}>
      {value}
    </bdi>
  )
}

export function Section({ icon: Icon, title, count, action, children }: { icon: LucideIcon; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Icon size={16} className="text-muted-foreground" aria-hidden="true" />
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground" dir="ltr">
              {count}
            </span>
          )}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

export function InfoItem({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon size={13} aria-hidden="true" />
        {label}
      </p>
      <div className="text-sm font-semibold">{children}</div>
    </div>
  )
}
