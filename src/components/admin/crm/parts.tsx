"use client"

import type { LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight, Home } from "lucide-react"
import { CrmPanel } from "@/components/crm/CrmShell"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { formatAmount } from "@/lib/admin-crm"
import { sarLtr, sarRtl } from "@/lib/riyal"

/** A stage's colour — the board's column strip, the dashboard's bar and the badge all read this one table. */
export const STAGE_TONE: Record<string, { badge: string; strip: string; bar: string }> = {
  new: { badge: "border-cta/20 bg-cta/10 text-cta", strip: "border-t-cta", bar: "bg-cta" },
  contacted: { badge: "border-teal/20 bg-teal/10 text-teal", strip: "border-t-teal", bar: "bg-teal" },
  demo: { badge: "border-warning/20 bg-warning/10 text-warning", strip: "border-t-warning", bar: "bg-warning" },
  negotiation: { badge: "border-primary/20 bg-primary/10 text-primary", strip: "border-t-primary", bar: "bg-primary" },
  converted: { badge: "border-success/20 bg-success/10 text-success", strip: "border-t-success", bar: "bg-success" },
  lost: { badge: "border-border bg-muted text-muted-foreground", strip: "border-t-border", bar: "bg-muted-foreground" },
  onboarding: { badge: "border-cta/20 bg-cta/10 text-cta", strip: "border-t-cta", bar: "bg-cta" },
  active: { badge: "border-success/20 bg-success/10 text-success", strip: "border-t-success", bar: "bg-success" },
  at_risk: { badge: "border-warning/20 bg-warning/10 text-warning", strip: "border-t-warning", bar: "bg-warning" },
  churned: { badge: "border-border bg-muted text-muted-foreground", strip: "border-t-border", bar: "bg-muted-foreground" },
}

/** A lead's or client's stage as a pill, in the stage's colour; it never breaks over two lines. */
export function StageBadge({ stage, label, className }: { stage: string; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", STAGE_TONE[stage]?.badge ?? STAGE_TONE.lost.badge, className)}>
      {label}
    </span>
  )
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

/** A titled section of a lead's or client's page — the subscribers' CRM panel, with its count and its add button. */
export function Section({ icon, title, count, action, children }: { icon: LucideIcon; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <CrmPanel icon={icon} title={title} count={count} action={action}>
      {children}
    </CrmPanel>
  )
}

/** The trail above a lead's or client's page (ADM-05): back to the CRM, then where this page sits. */
export function CrmTrail({ backHref, backLabel, crumbs }: { backHref: string; backLabel: string; crumbs: Array<{ label: string; href?: string }> }) {
  const locale = useLocale()
  const Back = locale === "ar" ? ChevronRight : ChevronLeft
  const Sep = locale === "ar" ? ChevronLeft : ChevronRight
  return (
    <nav aria-label={backLabel} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link
        href={backHref}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border bg-card px-3 text-xs font-bold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Back size={14} aria-hidden="true" />
        {backLabel}
      </Link>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <Sep size={12} className="shrink-0" aria-hidden="true" />}
            {i === 0 && <Home size={12} className="shrink-0" aria-hidden="true" />}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-bold text-foreground">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** «3 activities and 2 contacts and one quote» in the reader's language — the counts that moved on a merge or a conversion. */
export function useMovedCounts() {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  return (c: { activities: number; contacts: number; quotes: number }) => {
    const parts = [
      c.activities ? t("count_activities", { n: c.activities }) : "",
      c.contacts ? t("count_contacts", { n: c.contacts }) : "",
      c.quotes ? t("count_quotes", { n: c.quotes }) : "",
    ].filter(Boolean)
    return { parts, list: parts.length ? new Intl.ListFormat(locale === "ar" ? "ar" : "en", { type: "conjunction" }).format(parts) : "" }
  }
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
