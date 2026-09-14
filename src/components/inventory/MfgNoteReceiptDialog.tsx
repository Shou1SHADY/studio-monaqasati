"use client"

// Receipt at the destination (T19, DN-02/DN-03) — the destination's act: the
// warehouse receives finished goods into stock, the project receives into its
// custody. Whatever arrived broken or missing is recorded on the note: it is
// not delivered, not charged, and the workshop decides its re-make.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { round2 } from "@/lib/manufacturing-engine"
import { receiveDeliveryNote, type Actor } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import { noteOrderRef, type MfgDeliveryNote } from "@/lib/mfg-outside"
import { NoteShipmentFacts, RecordedAsLine, errText } from "./MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function MfgNoteReceiptDialog({
  note,
  orgId,
  actor,
  link,
  onClose,
}: {
  note: MfgDeliveryNote | null
  orgId: string
  actor: Actor
  /** Where the notification sends the workshop (its order). */
  link?: string | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [broken, setBroken] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBroken("")
    setText("")
    setError(null)
  }, [note?.id])

  if (!note) return null
  const shipped = note.item.quantity
  const brokenQty = Math.max(0, Number(broken) || 0)
  const over = brokenQty > shipped + 1e-9
  const net = Math.max(0, round2(shipped - brokenQty))
  const toProject = note.toKind === "project"

  const submit = async () => {
    if (!firestore || busy) return
    if (over) {
      setError(t("mfx_err_more_than_shipped"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await receiveDeliveryNote(firestore, { note, brokenQuantity: brokenQty, receivedNote: text.trim() || null, actor })
      // Best effort: the sender hears back, and the workshop managers when
      // something arrived broken — the re-make is theirs to decide.
      const facts = { number: note.noteNumber, ref: noteOrderRef(note), unit: note.item.unit }
      await Promise.all([
        emitMfgEvent(firestore, { copy: t, kind: "note_received", organizationId: orgId, actor, to: [{ users: [note.sentByUserId] }], params: { ...facts, qty: fmt(net) }, workOrderId: note.source.workOrderId, link: link ?? null }),
        // mfg.delivery.breakage — the re-make is the manager's call, recorded by Quality.
        brokenQty > 0
          ? emitMfgEvent(firestore, {
              kind: "note_breakage",
              copy: t,
              organizationId: orgId,
              actor,
              to: [{ permission: "manufacturing.manage" }, { permission: "manufacturing.qc" }],
              params: { ...facts, broken: fmt(brokenQty) },
              workOrderId: note.source.workOrderId,
              link: link ?? null,
            })
          : Promise.resolve(0),
      ])
      toast({
        title: t("mfx_dn_received_toast", { note: note.noteNumber, qty: fmt(net), unit: note.item.unit }),
        description: brokenQty > 0 ? t("mfx_dn_received_broken_toast", { qty: fmt(brokenQty), unit: note.item.unit }) : undefined,
      })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!note} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck size={18} className="text-success" aria-hidden="true" />
            {toProject ? t("mfx_dn_receive_custody_title", { note: note.noteNumber }) : t("mfx_dn_receive_title", { note: note.noteNumber })}
          </DialogTitle>
          <DialogDescription>{toProject ? t("mfx_dn_receive_custody_desc") : t("mfx_dn_receive_desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <dl className="overflow-hidden rounded-xl border bg-white text-xs">
            {[
              [t("mfx_dn_item"), <span key="i" dir="auto">{note.item.name}</span>],
              [t("mfx_dn_order"), <span key="o" dir="ltr" className="font-mono">{noteOrderRef(note)}</span>],
              [t("mfx_dn_shipped"), <span key="s" dir="ltr" className="tabular-nums">{fmt(shipped)} {note.item.unit}</span>],
              [t("mfx_dn_destination"), <span key="d" dir="auto">{note.toWarehouseName}</span>],
              [t("mfx_dn_sent"), <span key="b" dir="auto">{note.sentByUserName}</span>],
            ].map(([k, v], i) => (
              <div key={i} className="flex gap-3 border-b border-border/60 px-3.5 py-2 last:border-b-0">
                <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 font-semibold text-foreground">{v}</dd>
              </div>
            ))}
            <div className="px-3.5 py-2">
              <NoteShipmentFacts note={note} />
            </div>
          </dl>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mfx-broken">{t("mfx_dn_broken_label")}</Label>
              <Input
                id="mfx-broken"
                inputMode="decimal"
                dir="ltr"
                value={broken}
                placeholder="0"
                onChange={(e) => setBroken(sanitizeDecimalInput(e.target.value))}
                aria-invalid={over}
                className={cn("h-11", over && "border-destructive focus-visible:ring-destructive")}
                disabled={busy}
              />
              <p className={cn("text-[11px]", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {over ? t("mfx_err_more_than_shipped") : t("mfx_dn_broken_hint", { qty: fmt(shipped), unit: note.item.unit })}
              </p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border bg-success/5 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold text-muted-foreground">{toProject ? t("mfx_dn_net_custody") : t("mfx_dn_net_stock")}</span>
              <span className="text-lg font-black text-success" dir="ltr">
                <span className="tabular-nums">{fmt(net)}</span> <span className="text-xs font-semibold">{note.item.unit}</span>
              </span>
            </div>
          </div>

          {brokenQty > 0 && !over && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("mfx_dn_broken_effect", { qty: fmt(brokenQty), unit: note.item.unit })}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mfx-received-note">{t("dn_received_note")}</Label>
            <Textarea id="mfx-received-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          </div>

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {toProject ? t("mfx_dn_effect_custody") : t("mfx_dn_effect_stock")}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_dn_effect_read")}
            </li>
          </ul>

          <RecordedAsLine name={actor.name} />
        </div>

        <DialogFooter className="flex-wrap items-center gap-2">
          {error && (
            <span className="me-auto flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("crm_cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || over} className="gap-2 bg-success text-white hover:bg-success/90">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {toProject ? t("mfx_dn_receive_custody_btn") : t("mfx_dn_receive_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
