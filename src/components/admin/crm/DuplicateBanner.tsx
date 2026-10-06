"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { GitMerge, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { formatCrmDate, mergeDirection, type ClientRecord, type LeadMatch, type LeadRow } from "@/lib/admin-crm"
import { dismissDuplicate, mergeLeads } from "@/lib/admin-crm-writes"

/** ADM-09: a lead that may be the same person as another — who, why, and the three things to do about it. */
export function DuplicateBanner({
  row,
  match,
  rowsById,
  records,
  uid,
}: {
  row: LeadRow
  match: LeadMatch | undefined
  rowsById: Map<string, LeadRow>
  records: Record<string, ClientRecord>
  uid: string
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [merging, setMerging] = useState<LeadRow | null>(null)
  const [busy, setBusy] = useState(false)

  if (!match || (!match.duplicates.length && !match.client)) return null

  const others = match.duplicates.map((id) => rowsById.get(id)).filter((r): r is LeadRow => Boolean(r))

  const notDuplicate = async (other: LeadRow) => {
    if (!firestore) return
    try {
      await dismissDuplicate(firestore, row.crmId, other.crmId)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const merge = async () => {
    if (!firestore || !merging) return
    setBusy(true)
    try {
      const { keep } = mergeDirection(row, merging)
      const keepRow = keep === row.crmId ? row : merging
      const dropRow = keep === row.crmId ? merging : row
      await mergeLeads(firestore, keepRow, dropRow, records, uid)
      toast({ title: t("merge_done") })
      setMerging(null)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    } finally {
      setBusy(false)
    }
  }

  const mergePair = merging ? mergeDirection(row, merging) : null
  const keepRow = mergePair ? (mergePair.keep === row.crmId ? row : (merging as LeadRow)) : null
  const dropRow = mergePair ? (mergePair.drop === row.crmId ? row : (merging as LeadRow)) : null
  const label = (r: LeadRow) => [r.name, r.company].filter(Boolean).join(" — ")

  return (
    <div className="space-y-2">
      {match.client && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-bold">{t("flag_client", { name: match.client })}</p>
            <p className="text-xs text-muted-foreground">{t("match_hint")}</p>
          </div>
        </div>
      )}
      {others.map((o) => (
        <div key={o.crmId} className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <TriangleAlert size={18} className="shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t("dup_maybe", { name: label(o) })}</p>
            <p className="text-xs text-muted-foreground">
              {t(`channel_${o.channel}`)} · {t("dup_arrived", { date: formatCrmDate(o.createdMs, locale) })} · {t(`dup_reason_${match.reasons[o.crmId] ?? "name"}`)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMerging(o)}>
              <GitMerge size={14} aria-hidden="true" />
              {t("dup_merge")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void notDuplicate(o)}>
              {t("dup_not")}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/admin/crm/leads/${o.crmId}`}>{t("dup_open")}</Link>
            </Button>
          </div>
        </div>
      ))}

      <Dialog open={merging !== null} onOpenChange={(o) => !busy && !o && setMerging(null)}>
        <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{t("merge_title")}</DialogTitle>
            <DialogDescription>{t("merge_hint")}</DialogDescription>
          </DialogHeader>
          {keepRow && dropRow && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs font-semibold text-success">{t("merge_keep")}</p>
                <p className="font-bold">{label(keepRow)}</p>
                <p className="text-xs text-muted-foreground">{formatCrmDate(keepRow.createdMs, locale)}</p>
              </div>
              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground">{t("merge_drop")}</p>
                <p className="font-bold">{label(dropRow)}</p>
                <p className="text-xs text-muted-foreground">{formatCrmDate(dropRow.createdMs, locale)}</p>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("merge_moves")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void merge()} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GitMerge size={14} aria-hidden="true" />}
              {t("dup_merge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
