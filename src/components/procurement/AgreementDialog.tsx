"use client"

// Signing a price agreement, and renewing one (PRD 3.0 §4 `AGR`, §7.4).
//
// One dialog, two jobs, because they ask almost the same questions. Signing asks
// which supplier, for how long, and the price of each material. Renewing asks
// only for the new end date and the re-negotiated prices: the supplier and the
// materials are what the orders already placed on it point at, so they are shown
// and not editable. The form checks what the write checks again: a supplier, a
// start before the end, an end not in the past (a renewal's after today), and
// at least one priced material.

import { useEffect, useMemo, useState } from "react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useTranslations } from "next-intl"
import { Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { cleanAgreementLines, createPriceAgreement, renewPriceAgreement } from "@/lib/procurement/agreement-writes"
import { materialKey, renewalUntil, type PriceAgreement } from "@/lib/procurement/prices"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { ProcActor } from "@/lib/procurement/types"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

const emptyRow = () => ({ name: "", unit: "", price: "" })
const today = () => new Date().toISOString().slice(0, 10)

export function AgreementDialog({
  open,
  onOpenChange,
  actor,
  orgId,
  locale,
  /** Signing when absent; renewing the one given. */
  agreement,
  suppliers,
  knownMaterials = [],
  ownerHasTeam = false,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgId: string
  locale: string
  agreement?: PriceAgreement | null
  suppliers: Array<{ id: string; name: string }>
  /** Materials price history already knows, by the names orders gave them. An
   * agreement is compared with what we last paid only when its material is
   * named the same way — typed free, "حديد تسليح ١٢مم" never met the history's
   * "حديد تسليح" (UAT, 23 Sep). */
  knownMaterials?: Array<{ name: string; unit: string }>
  ownerHasTeam?: boolean
  onDone?: () => void
}) {
  const t = useTranslations("Portal.ProcPrices")
  const firestore = useFirestore()
  const renewing = Boolean(agreement)
  const knownKeys = useMemo(() => new Set(knownMaterials.map((k) => materialKey(k.name, k.unit))), [knownMaterials])
  const [error, setError] = useState<string | null>(null)

  const schema = z
    .object({
      supplierOrgId: z.string(),
      from: z.string(),
      until: z.string(),
      rows: z.array(z.object({ name: z.string(), unit: z.string(), price: z.string() })),
      note: z.string(),
    })
    .superRefine((v, ctx) => {
      const now = today()
      if (renewing) {
        if (!(v.until > now)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["until"], message: t("dialog.untilAfterToday") })
        return
      }
      if (!v.supplierOrgId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supplierOrgId"], message: t("err.supplier_missing") })
      if (!v.from || !v.until || v.until < v.from || v.until < now) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["until"], message: t("err.date_invalid") })
      if (!cleanAgreementLines(v.rows).length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows"], message: t("err.no_lines") })
    })
  type Values = z.infer<typeof schema>

  const blank = (): Values => ({ supplierOrgId: "", from: today(), until: "", rows: [emptyRow()], note: "" })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank() })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rows" })
  const rows = useWatch({ control: form.control, name: "rows" })
  const from = useWatch({ control: form.control, name: "from" })
  const errors = form.formState.errors

  // Reopening must not show the previous agreement's numbers.
  useEffect(() => {
    if (!open) return
    setError(null)
    form.reset(
      agreement
        ? { supplierOrgId: agreement.supplierOrgId, from: agreement.from, until: renewalUntil(agreement, today()), rows: (agreement.lines || []).map((l) => ({ name: l.name, unit: l.unit, price: String(l.price) })), note: agreement.note || "" }
        : blank()
    )
    // The form is reset only when it opens, never while somebody types.
  }, [open, agreement])

  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    setError(null)
    try {
      if (agreement) {
        const prices: Record<string, string> = {}
        for (const r of v.rows) prices[materialKey(r.name, r.unit)] = r.price
        await renewPriceAgreement(firestore, actor, agreement.id, { until: v.until, prices, note: v.note }, { ownerHasTeam })
      } else {
        await createPriceAgreement(
          firestore,
          actor,
          { organizationId: orgId, supplierOrgId: v.supplierOrgId, supplierName: suppliers.find((s) => s.id === v.supplierOrgId)?.name || "", from: v.from, until: v.until, lines: v.rows, note: v.note },
          { ownerHasTeam }
        )
      }
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      setError(err instanceof ProcWriteError ? t(`err.${err.code}`) : t("err.generic"))
    }
  })
  const busy = form.formState.isSubmitting

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{renewing ? t("dialog.renewTitle", { number: displayAgreementNumber(agreement?.docNumber, locale) }) : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{renewing ? t("dialog.renewDesc") : t("dialog.newDesc")}</DialogDescription>
        </DialogHeader>

        <form id="agr-form" onSubmit={submit} className="space-y-4" noValidate>
          {renewing ? (
            <p className="text-sm font-bold text-foreground" dir="auto">
              {agreement?.supplierName}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="agr-supplier">{t("dialog.supplier")}</Label>
              <NativeSelect
                id="agr-supplier"
                aria-invalid={Boolean(errors.supplierOrgId)}
                {...form.register("supplierOrgId")}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("dialog.pickSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              {errors.supplierOrgId && <p className="text-xs text-destructive">{errors.supplierOrgId.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agr-from">{t("dialog.from")}</Label>
              <Input id="agr-from" type="date" dir="ltr" disabled={renewing} {...form.register("from")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agr-until">{t("dialog.until")}</Label>
              <Input id="agr-until" type="date" dir="ltr" min={renewing ? today() : from} aria-invalid={Boolean(errors.until)} {...form.register("until")} />
            </div>
          </div>
          {errors.until && <p className="-mt-2 text-xs text-destructive">{errors.until.message}</p>}

          <div className="space-y-2">
            <Label>{t("dialog.lines")}</Label>
            {knownMaterials.length > 0 && (
              <datalist id="agr-known-materials">
                {knownMaterials.map((k) => (
                  <option key={materialKey(k.name, k.unit)} value={k.name}>
                    {k.unit}
                  </option>
                ))}
              </datalist>
            )}
            {fields.map((field, i) => {
              const r = rows?.[i] ?? field
              return (
                <div key={field.id} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      aria-label={t("dialog.material")}
                      placeholder={t("dialog.material")}
                      dir="auto"
                      disabled={renewing}
                      list={knownMaterials.length ? "agr-known-materials" : undefined}
                      {...form.register(`rows.${i}.name`, {
                        onChange: (e) => {
                          const known = knownMaterials.find((k) => k.name === e.target.value)
                          if (known && !form.getValues(`rows.${i}.unit`).trim()) form.setValue(`rows.${i}.unit`, known.unit)
                        },
                      })}
                    />
                    {!renewing && knownMaterials.length > 0 && r.name.trim() && r.unit.trim() && !knownKeys.has(materialKey(r.name, r.unit)) && (
                      <p className="text-[11px] leading-snug text-warning">{t("dialog.noHistoryForName")}</p>
                    )}
                  </div>
                  <div className="w-24 space-y-1">
                    <Input aria-label={t("dialog.unit")} placeholder={t("dialog.unit")} dir="auto" disabled={renewing} {...form.register(`rows.${i}.unit`)} />
                  </div>
                  <div className="w-28 space-y-1">
                    <Input aria-label={t("dialog.price")} placeholder={t("dialog.price")} inputMode="decimal" dir="ltr" {...form.register(`rows.${i}.price`)} />
                  </div>
                  {!renewing && fields.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("dialog.removeLine")} onClick={() => remove(i)}>
                      <X size={16} aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )
            })}
            {errors.rows?.message && <p className="text-xs text-destructive">{errors.rows.message}</p>}
            {!renewing && (
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyRow())}>
                <Plus size={14} className="me-1.5" aria-hidden="true" />
                {t("dialog.addLine")}
              </Button>
            )}
            {renewing && <p className="text-[11px] text-muted-foreground">{t("dialog.renewPricesHint")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agr-note">{t("dialog.note")}</Label>
            <Textarea id="agr-note" rows={2} dir="auto" placeholder={t("dialog.notePlaceholder")} {...form.register("note")} />
          </div>

          {error && <p className="text-sm font-bold text-destructive">{error}</p>}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" form="agr-form" disabled={busy}>
            {busy && <Loader2 className="me-1.5 animate-spin" size={14} aria-hidden="true" />}
            {renewing ? t("dialog.renew") : t("dialog.sign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
