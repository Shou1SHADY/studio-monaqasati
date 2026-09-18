"use client"

// One journal entry, in full: what it is, who captured it and when, the
// document it came from, and every line with its dimensions.
//
// The ledger, the account statements and the breakdown panel all list LINES —
// one side of an entry. An accountant reading a line needs the other side and
// the document behind it, so every such row opens this panel. The journal's own
// expanded row renders the same two pieces (`JournalEntryFacts`,
// `JournalEntryLines`), so the entry reads identically wherever it is opened.

import { useLocale, useTranslations } from "next-intl"
import { BookOpen, ExternalLink, FileText } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { accountName } from "@/lib/accounting/accounts"
import { toIsoTimestamp } from "@/lib/accounting/analytics"
import type { JournalEntry } from "@/lib/accounting/journal"
import { sourceDocumentPath } from "@/lib/accounting/source-links"
import { Money, accountingBasePath } from "./AccountingShell"
import { SOURCE_LABEL_KEY } from "./AccountingParts"

const LINK_CLASS = "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"

function formatStamp(iso: string | null, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function JournalEntryBadges({ entry }: { entry: JournalEntry }) {
  const t = useTranslations("Portal.Shared")
  const srcKey = SOURCE_LABEL_KEY[entry.sourceType]
  return (
    <>
      {srcKey && (
        <Badge variant="outline" className="text-[10px]">
          {t(srcKey)}
        </Badge>
      )}
      {entry.kind === "manual" && <Badge className="bg-cta/10 text-cta border-none text-[10px]">{t("acc_journal_kind_manual")}</Badge>}
      {entry.status === "draft" && <Badge className="bg-warning/10 text-warning border-none text-[10px]">{t("acc_status_draft")}</Badge>}
      {entry.reversedByEntryId && <Badge className="bg-muted text-muted-foreground border-none text-[10px]">{t("acc_entry_badge_reversed")}</Badge>}
      {entry.reversesEntryId && <Badge className="bg-destructive/10 text-destructive border-none text-[10px]">{t("acc_entry_badge_reversal")}</Badge>}
    </>
  )
}

/** Date, period, reference, who captured it and when — and the document behind it. */
export function JournalEntryFacts({ entry, portal, className }: { entry: JournalEntry; portal: CrmPortal; className?: string }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const captured = formatStamp(toIsoTimestamp(entry.createdAt), locale)
  const srcKey = SOURCE_LABEL_KEY[entry.sourceType]
  const path = sourceDocumentPath(entry, portal)
  const facts: [string, string | null, boolean][] = [
    [t("acc_date"), entry.date, true],
    [t("acc_period"), entry.period, true],
    [t("acc_entry_reference"), entry.reference || null, false],
    [t("acc_entry_captured_by"), entry.createdByUserName || null, false],
    [t("acc_entry_captured_at"), captured, true],
  ]
  return (
    <div className={cn("space-y-2", className)}>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
        {facts
          .filter(([, value]) => value)
          .map(([label, value, ltr]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="font-semibold truncate" dir={ltr ? "ltr" : "auto"}>
                <span className={cn(ltr && "tabular-nums")}>{value}</span>
              </dd>
            </div>
          ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-background px-3 py-2 text-xs">
        <FileText size={13} className="text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground">{t("acc_entry_source_doc")}</span>
        <span className="font-semibold">{srcKey ? t(srcKey) : entry.sourceType}</span>
        {path ? (
          <Link href={`/${portal}/${path}`} className={cn("ms-auto flex items-center gap-1 font-bold text-cta", LINK_CLASS)}>
            {t("acc_entry_open_source")}
            <ExternalLink size={11} className="rtl-flip" aria-hidden="true" />
          </Link>
        ) : (
          <span className="ms-auto text-[11px] text-muted-foreground">{t(entry.kind === "auto" ? "acc_entry_source_no_screen" : "acc_entry_source_is_entry")}</span>
        )}
      </div>
    </div>
  )
}

/** Every line of the entry. Account codes open the account's ledger; the
 * analytical dimensions appear only when some line carries one. */
export function JournalEntryLines({ entry, portal }: { entry: JournalEntry; portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const base = accountingBasePath(portal)
  const hasCenter = entry.lines.some((l) => l.costCenter || l.branch)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground font-bold">
          <tr>
            <th className="py-2 text-start">{t("acc_account_name")}</th>
            {hasCenter && <th className="py-2 text-start w-32">{t("acc_entry_cost_center")}</th>}
            <th className="py-2 text-end w-28">{t("acc_debit")}</th>
            <th className="py-2 text-end w-28">{t("acc_credit")}</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((line, i) => (
            <tr key={i} className="border-t border-border/50 align-top">
              <td className="py-1.5">
                <Link href={`${base}/ledger?account=${line.account}`} className={cn("tabular-nums font-mono text-primary me-2", LINK_CLASS)} dir="ltr" title={t("acc_breakdown_open_ledger")}>
                  {line.account}
                </Link>
                {accountName(line.account, locale)}
                {line.partyName && <span className="text-cta"> · {line.partyName}</span>}
                {line.projectName && <span className="text-muted-foreground"> · {line.projectName}</span>}
                {line.note && <span className="text-muted-foreground"> — {line.note}</span>}
              </td>
              {hasCenter && <td className="py-1.5 text-muted-foreground">{[line.costCenter, line.branch].filter(Boolean).join(" · ") || "—"}</td>}
              <td className="py-1.5 text-end">{line.debit ? <Money value={line.debit} /> : "—"}</td>
              <td className="py-1.5 text-end">{line.credit ? <Money value={line.credit} /> : "—"}</td>
            </tr>
          ))}
          <tr className="border-t font-bold">
            <td className="py-1.5" colSpan={hasCenter ? 2 : 1}>
              {t("acc_total")}
            </td>
            <td className="py-1.5 text-end">
              <Money value={entry.totalDebit} />
            </td>
            <td className="py-1.5 text-end">
              <Money value={entry.totalCredit} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function JournalEntrySheet({
  entry,
  entries,
  portal,
  onClose,
  onOpenEntry,
  showJournalLink = true,
}: {
  entry: JournalEntry | null
  /** All entries — to name the entry this one reverses, or is reversed by. */
  entries: JournalEntry[]
  portal: CrmPortal
  onClose: () => void
  /** Follow a reversal link inside the panel. */
  onOpenEntry?: (id: string) => void
  showJournalLink?: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const base = accountingBasePath(portal)
  const other = entry ? entries.find((e) => e.id === (entry.reversedByEntryId || entry.reversesEntryId)) : undefined

  return (
    <Sheet open={!!entry} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full sm:max-w-2xl overflow-y-auto" dir={isRtl ? "rtl" : "ltr"}>
        {entry && (
          <>
            <SheetHeader className="text-start space-y-1.5">
              <SheetTitle className="text-lg font-black text-primary leading-relaxed">
                <span className="tabular-nums text-muted-foreground me-2" dir="ltr">
                  #{entry.entryNumber}
                </span>
                <span className={cn(entry.reversedByEntryId && "line-through decoration-muted-foreground/60")}>{entry.description}</span>
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-1.5">
                  <JournalEntryBadges entry={entry} />
                </div>
              </SheetDescription>
            </SheetHeader>

            <JournalEntryFacts entry={entry} portal={portal} className="mt-4" />

            <div className="mt-4 rounded-xl border px-4 py-2">
              <JournalEntryLines entry={entry} portal={portal} />
            </div>

            {other && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                {entry.reversedByEntryId
                  ? t("acc_entry_reversed_by", { number: other.entryNumber, date: other.date })
                  : t("acc_entry_reverses", { number: other.entryNumber })}
                {onOpenEntry && (
                  <button type="button" onClick={() => onOpenEntry(other.id)} className={cn("ms-2 font-bold text-cta", LINK_CLASS)}>
                    {t("acc_entry_open_other", { number: other.entryNumber })}
                  </button>
                )}
              </p>
            )}

            {showJournalLink && (
              <Link href={`${base}/journal?entry=${encodeURIComponent(entry.id)}`} className={cn("mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-cta", LINK_CLASS)}>
                <BookOpen size={13} aria-hidden="true" />
                {t("acc_entry_open_in_journal")}
              </Link>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
