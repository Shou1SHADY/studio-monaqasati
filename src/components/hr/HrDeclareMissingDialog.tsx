"use client"

// The missing-days declaration (PRD AT-04, form 19, WF-05): the days a
// workplace has no sheet for, filled by a named person who states that the
// people there were at work on them. Each person counts only from the day he
// joined or moved in; a money role sees what those days cost in wages. The
// declaration stays on record, and absences are corrected afterwards.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useOrgPay } from "@/hooks/useHrPeople"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { declarationRoster, declareBlocks, type WorkplaceMonth } from "@/lib/hr/attendance"
import { declareMissing, type SiteRef } from "@/lib/hr/attendance-writes"
import type { HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { wageOf } from "@/lib/hr/pay"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

export function HrDeclareMissingDialog({
  access,
  actor,
  site,
  siteName,
  month,
  wm,
  missing,
  people,
  onClose,
}: {
  access: HrAccess
  actor: HrActor
  site: SiteRef
  siteName: string
  month: string
  wm: WorkplaceMonth | null
  missing: string[]
  /** The people the record places on the workplace. */
  people: HrEmployee[]
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money)
  const [pick, setPick] = useState<string[]>(missing)
  const [note, setNote] = useState("")
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const missingKey = missing.join(",")
  useEffect(() => setPick(missingKey ? missingKey.split(",") : []), [missingKey])

  const roster = useMemo(() => declarationRoster(people, pick), [people, pick])
  const manDays = Object.values(roster.manDays).reduce((a, b) => a + b, 0)
  const wages = money ? Object.entries(roster.manDays).reduce((sum, [id, n]) => sum + (pays.get(id) ? (wageOf(pays.get(id)!) / 30) * n : 0), 0) : 0
  const blocks = declareBlocks({ days: pick, note, missing, closed: Boolean(wm?.closed), ack })

  const submit = async () => {
    if (!firestore || !access.orgId || blocks.length) return
    setBusy(true)
    try {
      await declareMissing(firestore, access.ctx, access.orgId, site, month, actor, { days: pick, note, ack })
      toast({ title: t("att.declared") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `att.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save", { n: missing.length }), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("att.fill_title", { site: siteName })}</DialogTitle>
          <DialogDescription>{t("att.fill_sub", { month, n: missing.length, people: people.length })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="warn" title={t("att.fill_why_title")}>
            {t("att.fill_why")}
          </Callout>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("att.missing_title")}>
            {missing.map((d) => (
              <label key={d} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", pick.includes(d) && "border-warning bg-warning/10")}>
                <Checkbox checked={pick.includes(d)} onCheckedChange={(c) => setPick((p) => (c ? [...p, d] : p.filter((x) => x !== d)))} disabled={busy} aria-label={hrDate(d, locale)} />
                {hrDate(d, locale)}
              </label>
            ))}
          </div>
          <div className="rounded-xl border px-3">
            <KeyValueRow label={t("att.fill_man_days")} value={<span className="tabular-nums">{manDays}</span>} strong />
            <KeyValueRow label={t("att.fill_people")} value={<span className="tabular-nums">{roster.employees.length}</span>} />
            {money && <KeyValueRow label={t("att.fill_wages")} value={hrMoney(Math.round(wages))} ltr />}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fill-note">{t("att.declare_note")}</Label>
            <Textarea id="fill-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
            <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} disabled={busy} className="mt-0.5" aria-label={t("att.fill_ack")} />
            <span>{t("att.fill_ack")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t("att.fill_by", { name: actor.name || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`att.block.${b}`, { n: missing.length }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("att.fill_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
