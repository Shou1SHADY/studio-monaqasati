"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { createQuoteRequest, loadPermissionRecipients } from "@/lib/sales-transfers"

type LineRow = { name: string; unit: string; quantity: string }

const emptyLine = (): LineRow => ({ name: "", unit: "", quantity: "" })

/**
 * CRM's door into Sales: "quote this for my client". The request lands in the
 * Sales inbox with its lines and due date; Sales prices it or returns it with
 * a factual reason. CRM never prices, Sales never registers a client.
 */
export function RequestQuoteDialog({
  open,
  onOpenChange,
  orgId,
  contact,
  actorName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  contact: { id: string; name: string | null }
  actorName: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [lines, setLines] = useState<LineRow[]>([emptyLine()])
  const [dueDate, setDueDate] = useState("")
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLines([emptyLine()])
    setDueDate("")
    setNote("")
  }, [open])

  const updateLine = (index: number, patch: Partial<LineRow>) =>
    setLines((p) => p.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!firestore || !user || isSaving) return
    const parsed = lines
      .filter((l) => l.name.trim() && Number(l.quantity) > 0)
      .map((l) => ({ name: l.name.trim(), unit: l.unit.trim(), quantity: Number(l.quantity) }))
    if (parsed.length === 0) {
      toast({ title: t("crm_rq_no_lines"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const recipients = await loadPermissionRecipients(firestore, orgId, user.uid, ["sales.manage"])
      await createQuoteRequest(firestore, {
        organizationId: orgId,
        contact,
        lines: parsed,
        note,
        dueDate: dueDate || null,
        actor: { id: user.uid, name: actorName },
        recipients,
        notification: {
          title: t("crm_rq_notif_title"),
          message: t("crm_rq_notif_msg", { contact: contact.name || "—", count: parsed.length }),
          i18n: { title: "crm_rq_notif_title", message: "crm_rq_notif_msg", params: { contact: contact.name || "—", count: parsed.length } },
        },
      })
      toast({ title: t("crm_rq_sent_toast") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isSaving) onOpenChange(o) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-lg w-[calc(100vw-2rem)] overflow-x-hidden max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pe-8 flex items-center gap-2">
            <Send size={17} className="text-cta" aria-hidden="true" />
            {t("crm_rq_title")}
          </DialogTitle>
          <DialogDescription>{t("crm_rq_desc", { contact: contact.name || "—" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <div className="space-y-2">
            <Label>{t("crm_rq_lines")}</Label>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <Input
                  className="h-9 flex-1 min-w-[150px]"
                  placeholder={t("crm_rq_line_name")}
                  value={l.name}
                  onChange={(e) => updateLine(i, { name: e.target.value })}
                  disabled={isSaving}
                />
                <Input
                  className="h-9 w-20"
                  placeholder={t("crm_rq_line_unit")}
                  value={l.unit}
                  onChange={(e) => updateLine(i, { unit: e.target.value })}
                  disabled={isSaving}
                />
                <Input
                  className="h-9 w-24"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder={t("crm_rq_line_qty")}
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  disabled={isSaving}
                />
                <button
                  type="button"
                  className="h-9 w-9 grid place-items-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                  disabled={isSaving || lines.length === 1}
                  aria-label={t("crm_cancel")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setLines((p) => [...p, emptyLine()])} disabled={isSaving}>
              <Plus size={13} />
              {t("crm_rq_add_line")}
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rq-due">{t("crm_rq_due")}</Label>
              <Input id="rq-due" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-note">{t("crm_rq_note")}</Label>
            <Textarea id="rq-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={isSaving} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("crm_cancel")}</Button>
          <Button onClick={submit} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t("crm_rq_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
