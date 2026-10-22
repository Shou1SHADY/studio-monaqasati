"use client"

// The buyer's four asks on an offer, each a small dialog over `decideOffer()` (RFQ-10/11/12, CMP-18): exclude with a reason
// (the numbers suggest one, «سبب آخر» needs words), «اطلب توضيحاً», «اطلب سعراً أفضل» (one round, a reply-by day and a note,
// never another supplier's price) and «اطلب تأكيد السعر» for an expired offer. Nothing here writes to the offer: the server does.

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { DecisionRefused, decideOffer } from "@/lib/procurement/offer-decisions-client"
import type { DecideInput, DecisionResult } from "@/lib/procurement/offer-decisions-server"
import { BAFO_NOTE_MAX, EXCLUSION_REASONS, suggestedExclusion, type ExclusionReason } from "@/lib/procurement/offer-decisions"
import { OTHER_REASON_MIN_CHARS, addDaysISO } from "@/lib/procurement/offer-calc"
import { warrantyOf, type OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import type { RfqView } from "./rfqOfferView"
import { cn } from "@/lib/utils"

export type DecisionDone = (result: DecisionResult, row: OfferRowModel) => void

function useDecide() {
  const terr = useTranslations("Portal.Procurement.rfqpage.err")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (body: DecideInput): Promise<DecisionResult | null> => {
    setBusy(true)
    try {
      return await decideOffer(body)
    } catch (err) {
      const code = err instanceof DecisionRefused ? err.code : "INTERNAL"
      toast({ title: terr.has(code) ? terr(code) : terr("generic"), variant: "destructive" })
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function Shell({ open, onOpenChange, title, sub, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; sub?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{title}</DialogTitle>
          {sub && <DialogDescription>{sub}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter className="gap-2 sm:gap-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Common {
  row: OfferRowModel | null
  onOpenChange: (open: boolean) => void
  onDone: DecisionDone
  fallbackName: string
}

// ---------------------------------------------------------------------------
// استبعد
// ---------------------------------------------------------------------------

export function ExcludeDialog({ row, rfq, onOpenChange, onDone, fallbackName }: Common & { rfq: RfqView }) {
  const tex = useTranslations("Portal.Procurement.rfqpage.exclude")
  const { busy, run } = useDecide()
  const [code, setCode] = useState<ExclusionReason | "">("")
  const [text, setText] = useState("")
  const suggested = row ? suggestedExclusion({ warrantyShort: warrantyOf(row.offer, rfq)?.short ?? false, validityShort: row.validity === "soon" }) : null
  const needsText = code === "other"
  const ok = Boolean(code) && (!needsText || text.trim().length >= OTHER_REASON_MIN_CHARS)
  const name = row ? row.name || fallbackName : ""

  const submit = async () => {
    if (!row || !code) return
    const out = await run({ action: "exclude", offerId: row.id, code, ...(text.trim() ? { text: text.trim() } : {}) })
    if (out) {
      setCode("")
      setText("")
      onDone(out, row)
    }
  }

  return (
    <Shell
      open={row != null}
      onOpenChange={(o) => {
        if (!o) {
          setCode("")
          setText("")
        }
        onOpenChange(o)
      }}
      title={tex("title", { name })}
      sub={tex("sub")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tex("back")}
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={!ok || busy} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {tex("submit")}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-bold text-muted-foreground">{tex("reason")}</legend>
        {EXCLUSION_REASONS.map((r) => (
          <label key={r} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", code === r && "border-primary bg-primary/5")}>
            <input type="radio" name="exclusion" value={r} checked={code === r} onChange={() => setCode(r)} />
            <span className="flex-1">{tex(`code.${r}`)}</span>
            {suggested === r && <span className="rounded-full bg-cta/10 px-2 text-[10px] font-bold text-cta">{tex("suggested")}</span>}
          </label>
        ))}
      </fieldset>
      {needsText && (
        <div className="space-y-1">
          <Label htmlFor="exclusion-text" className="text-xs font-bold">
            {tex("other_text")}
          </Label>
          <Textarea id="exclusion-text" value={text} maxLength={500} rows={3} onChange={(e) => setText(e.target.value)} placeholder={tex("other_ph")} />
          {text.trim().length < OTHER_REASON_MIN_CHARS && <p className="text-[11px] text-muted-foreground">{tex("other_min", { count: OTHER_REASON_MIN_CHARS })}</p>}
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// اطلب توضيحاً
// ---------------------------------------------------------------------------

export function ClarifyDialog({ row, onOpenChange, onDone, fallbackName }: Common) {
  const tcl = useTranslations("Portal.Procurement.rfqpage.clarify")
  const { busy, run } = useDecide()
  const [question, setQuestion] = useState("")
  const name = row ? row.name || fallbackName : ""
  const submit = async () => {
    if (!row || !question.trim()) return
    const out = await run({ action: "clarify", offerId: row.id, question: question.trim() })
    if (out) {
      setQuestion("")
      onDone(out, row)
    }
  }
  return (
    <Shell
      open={row != null}
      onOpenChange={onOpenChange}
      title={tcl("title", { name })}
      sub={tcl("sub")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tcl("back")}
          </Button>
          <Button type="button" onClick={submit} disabled={!question.trim() || busy} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {tcl("submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <Label htmlFor="clarify-q" className="text-xs font-bold">
          {tcl("question")}
        </Label>
        <Textarea id="clarify-q" value={question} maxLength={1000} rows={4} onChange={(e) => setQuestion(e.target.value)} />
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// اطلب سعراً أفضل
// ---------------------------------------------------------------------------

export function BafoDialog({ row, onOpenChange, onDone, fallbackName, today }: Common & { today: string }) {
  const tba = useTranslations("Portal.Procurement.rfqpage.bafo")
  const { busy, run } = useDecide()
  const [replyBy, setReplyBy] = useState(addDaysISO(today, 2))
  const [note, setNote] = useState("")
  const name = row ? row.name || fallbackName : ""
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(replyBy) && replyBy >= today
  const submit = async () => {
    if (!row || !ok) return
    const out = await run({ action: "bafo", offerId: row.id, replyBy, ...(note.trim() ? { note: note.trim() } : {}) })
    if (out) {
      setNote("")
      onDone(out, row)
    }
  }
  return (
    <Shell
      open={row != null}
      onOpenChange={onOpenChange}
      title={tba("title", { name })}
      sub={tba("sub")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tba("back")}
          </Button>
          <Button type="button" onClick={submit} disabled={!ok || busy} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {tba("submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <Label htmlFor="bafo-by" className="text-xs font-bold">
          {tba("reply_by")}
        </Label>
        <Input id="bafo-by" type="date" dir="ltr" min={today} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
        {!ok && <p className="text-[11px] text-destructive">{tba("err_date")}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="bafo-note" className="text-xs font-bold">
          {tba("note")}
        </Label>
        <Textarea id="bafo-note" value={note} maxLength={BAFO_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-[11px] text-muted-foreground">{tba("hint")}</p>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// اطلب تأكيد السعر
// ---------------------------------------------------------------------------

export function RevalDialog({ row, onOpenChange, onDone, fallbackName }: Common) {
  const trv = useTranslations("Portal.Procurement.rfqpage.reval")
  const { busy, run } = useDecide()
  const [note, setNote] = useState("")
  const name = row ? row.name || fallbackName : ""
  const submit = async () => {
    if (!row) return
    const out = await run({ action: "confirm-price", offerId: row.id, ...(note.trim() ? { note: note.trim() } : {}) })
    if (out) {
      setNote("")
      onDone(out, row)
    }
  }
  return (
    <Shell
      open={row != null}
      onOpenChange={onOpenChange}
      title={trv("title", { name })}
      sub={trv("sub")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {trv("back")}
          </Button>
          <Button type="button" onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {trv("submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <Label htmlFor="reval-note" className="text-xs font-bold">
          {trv("note")}
        </Label>
        <Textarea id="reval-note" value={note} maxLength={BAFO_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Shell>
  )
}

export { useDecide }
