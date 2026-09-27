"use client"

// Measurement sheet (form 17, WF-04): quantities per BOQ item on a day. It
// moves nothing until the PM approves it — unless the writer holds approve, in
// which case saving approves it and says so. On a lump sum, a quantity over the
// item's remaining is flagged: it is cut at approval, and the extra needs a
// variation. The site engineer sees no prices.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { gateOf } from "@/lib/pm/inspection"
import { overRemaining, remainingOf, sheetBlocks, sheetNo, type MeasuredItem } from "@/lib/pm/measurement"
import { PmSheetError, writeSheet, type SheetActor } from "@/lib/pm/measurement-writes"
import type { PricingBasis } from "@/lib/pm/terms"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"

export interface SheetItem extends MeasuredItem {
  code: string
  description: string
  unit: string
}

export function WriteSheetDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  items,
  basis,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: SheetActor
  items: SheetItem[]
  basis: PricingBasis
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [day, setDay] = useState(today)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDay(todayDay())
      setQty({})
      setNote("")
      setSearch("")
    }
  }, [open])

  const self = access.has("approve")
  const money = access.has("money")
  const lines = useMemo(
    () =>
      Object.entries(qty)
        .map(([itemId, v]) => ({ itemId, code: items.find((i) => i.id === itemId)?.code ?? null, qty: v.trim() === "" ? 0 : Number(v) }))
        .filter((l) => l.qty !== 0),
    [qty, items]
  )
  const blocks = sheetBlocks({ archived: access.ctx.archived, lines, items })
  const shown = items.filter((i) => !search.trim() || matchesSearch(search, [i.code, i.description]))
  const fmt = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 2 })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const r = await writeSheet(firestore, access.ctx, projectId, actor, { day, lines, note })
      toast({ title: t(r.self ? "meas.saved_self" : "meas.saved", { no: sheetNo(r.seq) }), description: r.wentLive ? t("meas.went_live") : undefined })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSheetError && err.blocks[0] ? `meas.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("meas.new_title")}</DialogTitle>
          <DialogDescription>{t(self ? "meas.new_desc_self" : "meas.new_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ms-day">{t("meas.day")}</Label>
              <Input id="ms-day" type="date" max={today} dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-search">{t("meas.search")}</Label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="ms-search" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" disabled={busy} />
              </div>
            </div>
          </div>
          {basis === "lump" && <Callout tone="info">{t("meas.lump_note")}</Callout>}
          {items.length === 0 ? (
            <Callout tone="warn">{t("meas.no_boq")}</Callout>
          ) : (
            <ul className="max-h-[45vh] divide-y overflow-y-auto rounded-xl border">
              {shown.map((i) => {
                const v = qty[i.id] ?? ""
                const n = v.trim() === "" ? 0 : Number(v)
                const over = overRemaining(basis, i, n)
                const gate = gateOf(i.gate ?? {})
                const locked = gate !== "free" && gate !== "passed"
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate text-sm font-semibold" dir="auto">
                        <span className="me-1.5 text-xs text-muted-foreground" dir="ltr">
                          {i.code}
                        </span>
                        {i.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("meas.remaining", { qty: fmt(remainingOf(i)), unit: i.unit || "—" })}
                        {money && i.rate <= 0 && <span className="ms-2 font-semibold text-warning">{t("meas.unpriced")}</span>}
                      </p>
                      {over > 0 && <p className="text-xs font-semibold text-destructive">{t("meas.over", { qty: fmt(over), unit: i.unit || "" })}</p>}
                      {locked && <p className="text-xs font-semibold text-destructive">{t(`meas.gate.${gate}` as "meas.gate.needs")}</p>}
                    </div>
                    <Input
                      aria-label={t("meas.qty_for", { code: i.code })}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      dir="ltr"
                      value={v}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                      className={cn("h-11 w-28", (over > 0 || n < 0) && "border-destructive")}
                      disabled={busy || locked}
                    />
                  </li>
                )
              })}
            </ul>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ms-note">{t("meas.note")}</Label>
            <Textarea id="ms-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`meas.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t(self ? "meas.save_self" : "meas.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
