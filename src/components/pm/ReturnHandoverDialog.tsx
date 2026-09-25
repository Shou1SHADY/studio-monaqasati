"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { HANDOVER_MISSING, type HandoverMissing, type PmHandover } from "@/lib/pm/handover"
import { returnHandover, type PmActor } from "@/lib/pm/handover-writes"
import { cn } from "@/lib/utils"

/** Return a handover to CRM for completion, naming what is missing out of six (HO-03). */
export function ReturnHandoverDialog({ open, onOpenChange, handover, actor }: { open: boolean; onOpenChange: (open: boolean) => void; handover: PmHandover; actor: PmActor }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [missing, setMissing] = useState<HandoverMissing[]>([])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setMissing([])
      setNote("")
    }
  }, [open])

  const toggle = (m: HandoverMissing) => setMissing((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))

  const save = async () => {
    if (!firestore || !missing.length) return
    setBusy(true)
    try {
      await returnHandover(firestore, actor, handover.id, {
        missing,
        note,
        missingText: missing.map((m) => t(`missing.${m}`)).join("، "),
        notification: { title: t("notif.returned_title"), message: t("notif.returned_message", { project: handover.title, count: missing.length }) },
      })
      toast({ title: t("return.done", { count: missing.length }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("return.title")}</DialogTitle>
          <DialogDescription>{t("return.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("return.what")}</legend>
            <div className="grid gap-2">
              {HANDOVER_MISSING.map((m) => {
                const on = missing.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(m)}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 text-start text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-destructive/40 bg-destructive/5" : "hover:border-module/40"
                    )}
                  >
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded border", on ? "border-destructive bg-destructive text-destructive-foreground" : "border-input")}>
                      {on && <Check size={13} aria-hidden="true" />}
                    </span>
                    {t(`missing.${m}`)}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="return-note">{t("return.note")}</Label>
            <Textarea id="return-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={busy || !missing.length}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("return.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
