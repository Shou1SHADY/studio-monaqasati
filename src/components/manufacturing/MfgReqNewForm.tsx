"use client"

// Asking the workshop to make something. The request is screened before it
// is sent — the requester sees the answer to expect (make, make part, or buy)
// instead of waiting a day to find out.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { FilePlus2, FolderKanban, Plus, ShoppingCart, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgRequestLine } from "@/lib/sales-orders"
import { createMfgRequestV2 } from "@/lib/manufacturing-writes"
import { parseQty, screenRequest, validateNewRequest, type NewRequestDraft } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgChoiceCards, MfgEffects, MfgField, MfgFormModal, MfgNote, fmtQty } from "./ui/MfgUi"
import { useScreenContext, useVerdictReasonText, verdictLabel } from "./MfgReqBits"

export function MfgReqNewForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const ctx = useScreenContext()
  const reasonText = useVerdictReasonText()

  const [draft, setDraft] = useState<NewRequestDraft>({
    sourceKind: data.projects.length ? "project" : "procurement",
    projectId: "",
    neededBy: "",
    rows: [{ productId: "", quantity: "" }],
  })
  const [note, setNote] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { ok, errors } = validateNewRequest(draft, ctx.today)
  const show = attempted

  const lines: MfgRequestLine[] = useMemo(
    () =>
      draft.rows.flatMap((row) => {
        const p = data.productById.get(row.productId)
        const quantity = parseQty(row.quantity)
        return p && quantity > 0 ? [{ productId: p.id, itemName: p.name, unit: p.unit, quantity }] : []
      }),
    [draft.rows, data.productById]
  )

  const screening = useMemo(
    () => (lines.length && draft.neededBy ? screenRequest({ lines, itemName: "", unit: "", quantity: 0, neededBy: draft.neededBy }, ctx) : []),
    [lines, draft.neededBy, ctx]
  )
  const tone = !screening.length
    ? "info"
    : screening.some((l) => l.verdict?.kind === "buy_capacity")
      ? "bad"
      : screening.every((l) => l.verdict?.kind === "make")
        ? "ok"
        : "warn"

  const setRow = (i: number, patch: Partial<NewRequestDraft["rows"][number]>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    setError(null)
    if (!ok) {
      setError(t("mfg3_req_err_form"))
      return
    }
    setBusy(true)
    try {
      const project = draft.sourceKind === "project" ? data.projects.find((p) => p.id === draft.projectId) : null
      await createMfgRequestV2(firestore, {
        organizationId: data.orgId,
        sourceKind: draft.sourceKind,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        neededBy: draft.neededBy || null,
        lines,
        note: note.trim() || null,
        actor: data.actor,
      })
      toast({ title: t("mfg2_request_sent_toast", { hours: data.settings.answerWindowHours }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(t("mfg_save_error"))
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={FilePlus2}
      title={t("mfg3_action_request")}
      subtitle={t("mfg3_req_new_sub", { hours: data.settings.answerWindowHours })}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg2_send_request")}
      size="lg"
    >
      {!data.products.length && <MfgNote tone="warn">{t("mfg3_req_new_no_products")}</MfgNote>}

      <MfgChoiceCards
        value={draft.sourceKind}
        onChange={(v) => setDraft((d) => ({ ...d, sourceKind: v }))}
        options={[
          { id: "project", icon: FolderKanban, title: t("mfg3_req_new_src_project"), description: t("mfg3_req_new_src_project_desc"), disabled: !data.projects.length },
          { id: "procurement", icon: ShoppingCart, title: t("mfg3_req_new_src_procurement"), description: t("mfg3_req_new_src_procurement_desc") },
        ]}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {draft.sourceKind === "project" && (
          <MfgField label={t("mfg2_field_project")} required error={show && errors.project ? t("mfg3_req_err_project") : undefined} htmlFor="mfg-new-req-project">
            <Select value={draft.projectId} onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}>
              <SelectTrigger id="mfg-new-req-project" aria-invalid={show && errors.project}>
                <SelectValue placeholder={t("mfg3_req_pick_project")} />
              </SelectTrigger>
              <SelectContent>
                {data.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MfgField>
        )}
        <MfgField
          label={t("mfg2_field_needed_by")}
          required
          hint={t("mfg3_req_needed_hint")}
          error={show && errors.neededBy ? t(errors.neededBy === "past" ? "mfg3_req_err_needed_past" : "mfg3_req_err_needed_by") : undefined}
          htmlFor="mfg-new-req-needed"
        >
          <Input
            id="mfg-new-req-needed"
            type="date"
            min={ctx.today}
            value={draft.neededBy}
            aria-invalid={show && !!errors.neededBy}
            onChange={(e) => setDraft((d) => ({ ...d, neededBy: e.target.value }))}
          />
        </MfgField>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-700">
          {t("mfg3_req_new_lines")}
          <span className="ms-0.5 text-warning">*</span>
        </p>
        {draft.rows.map((row, i) => {
          const product = data.productById.get(row.productId)
          const rowErr = show ? errors.rows[i] : null
          return (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border bg-white p-2.5 sm:grid-cols-[1fr_9rem_auto]">
              <div className="col-span-2 sm:col-span-1">
                <Select value={row.productId} onValueChange={(v) => setRow(i, { productId: v })}>
                  <SelectTrigger aria-label={t("mfg2_field_product")} aria-invalid={!!rowErr?.product} className={cn(rowErr?.product && "border-destructive")}>
                    <SelectValue placeholder={t("mfg2_field_product")} />
                  </SelectTrigger>
                  <SelectContent>
                    {data.products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rowErr?.product && <p className="mt-1 text-[11px] font-semibold text-destructive">{t("mfg3_req_err_product")}</p>}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={t("mfg2_field_quantity")}
                    placeholder={t("mfg2_field_quantity")}
                    aria-invalid={!!rowErr?.quantity}
                    className={cn("tabular-nums", rowErr?.quantity && "border-destructive")}
                    value={row.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                  />
                  {product && <span className="shrink-0 text-[11px] text-muted-foreground">{product.unit}</span>}
                </div>
                {rowErr?.quantity && <p className="mt-1 text-[11px] font-semibold text-destructive">{t("mfg2_err_quantity_required")}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-muted-foreground hover:text-destructive"
                aria-label={t("mfg3_req_remove_line")}
                disabled={draft.rows.length === 1}
                onClick={() => setDraft((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== i) }))}
              >
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </div>
          )
        })}
        {show && errors.noLines && <p className="text-[11px] font-semibold text-destructive">{t("mfg3_req_err_no_lines")}</p>}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, { productId: "", quantity: "" }] }))}
        >
          <Plus size={13} aria-hidden="true" /> {t("mfg2_add_line")}
        </Button>
      </div>

      <MfgField label={t("mfg2_field_note_optional")} htmlFor="mfg-new-req-note">
        <Input id="mfg-new-req-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("mfg3_req_new_note_ph")} />
      </MfgField>

      <MfgNote tone={tone} title={t("mfg3_req_new_expect")}>
        {screening.length ? (
          <ul className="space-y-1">
            {screening.map((l) => (
              <li key={l.index} dir="auto">
                <b>
                  {l.line.itemName} × {fmtQty(l.line.quantity)}:
                </b>{" "}
                {l.verdict ? `${verdictLabel(l.verdict, t)} — ${reasonText(l.reason)}` : t("mfg2_no_product_card")}
              </li>
            ))}
            <li className="opacity-80">{t("mfg3_req_new_expect_hint")}</li>
          </ul>
        ) : (
          t("mfg3_req_new_expect_empty")
        )}
      </MfgNote>

      <MfgEffects
        items={[
          { text: t("mfg3_req_new_eff_sent") },
          { text: t("mfg3_req_new_eff_window", { hours: data.settings.answerWindowHours }) },
        ]}
      />
    </MfgFormModal>
  )
}
