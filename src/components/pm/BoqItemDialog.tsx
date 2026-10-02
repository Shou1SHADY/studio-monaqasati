"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { judgeBoqRow, type PmBoqLine } from "@/lib/pm/boq"
import { PmBoqError, saveBoqItem } from "@/lib/pm/boq-writes"

const text = (n: number) => (n > 0 ? String(n) : "")

export function BoqItemDialog({ projectId, access, money, line, existingCodes, onClose }: { projectId: string; access: PmAccess; money: boolean; line: PmBoqLine | null; existingCodes: string[]; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [code, setCode] = useState(line?.code ?? "")
  const [description, setDescription] = useState(line?.description ?? "")
  const [unit, setUnit] = useState(line?.unit ?? "")
  const [quantity, setQuantity] = useState(line ? text(line.quantity) : "")
  const [rate, setRate] = useState(line ? text(line.rate) : "")
  const [cost, setCost] = useState(line ? text(line.estCost) : "")
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const row = useMemo(() => judgeBoqRow({ code, description, unit, quantity, rate, cost }, existingCodes), [code, description, unit, quantity, rate, cost, existingCodes])

  const save = async () => {
    setTouched(true)
    if (!firestore || row.problems.length) return
    setBusy(true)
    try {
      await saveBoqItem(firestore, access.ctx, projectId, row, line?.id ?? null)
      toast({ title: t(line ? "boq.item_saved" : "boq.item_added", { code: row.code }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmBoqError ? `boq.import_err.${err.code}` : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(line ? "boq.item_edit_title" : "boq.item_add_title")}</DialogTitle>
          <DialogDescription>{t("boq.item_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bi-code">
                {t("boq.f_code")} <span className="text-warning">*</span>
              </Label>
              <Input id="bi-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="02-01-01" disabled={busy} aria-invalid={touched && row.problems.includes("code_format")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bi-desc">
                {t("boq.f_desc")} <span className="text-warning">*</span>
              </Label>
              <Input id="bi-desc" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} aria-invalid={touched && row.problems.includes("no_description")} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bi-unit">{t("boq.f_unit")}</Label>
              <Input id="bi-unit" dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="m3" disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bi-qty">
                {t("boq.qty")} <span className="text-warning">*</span>
              </Label>
              <Input id="bi-qty" dir="ltr" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" disabled={busy} aria-invalid={touched && row.problems.includes("bad_qty")} />
            </div>
          </div>
          {money && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bi-rate">{t("boq.rate")}</Label>
                <Input id="bi-rate" dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bi-cost">{t("boq.unit_cost")}</Label>
                <Input id="bi-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" disabled={busy} />
              </div>
            </div>
          )}
          {line && line.executed > 0 && <Callout tone="warn">{t("boq.item_executed_note", { qty: line.executed })}</Callout>}
          <BlockingReasons title={t("cannot_save")} reasons={touched ? row.problems.map((p) => t(`boq.problem.${p}`)) : []} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t(line ? "boq.item_save" : "boq.item_add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
