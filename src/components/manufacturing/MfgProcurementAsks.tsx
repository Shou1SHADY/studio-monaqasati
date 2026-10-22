"use client"

// «نصنّع أم نشتري؟» (Procurement 2.0, INC-08, WF-05): the stone Procurement asked the workshop about (`proc:MK`), with the last price it
// paid. The workshop makes all of it, makes part under a work order, or says «يُشترى» with a reason. After a day with no answer the
// decision returns to Procurement and a late answer is refused. Only `manufacturing.manage` answers (`mfg:MK`).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { beforeError } from "@/components/procurement/BeforeBuying"
import { fmtDay } from "@/components/procurement/need-bits"
import { useUser } from "@/firebase"
import { useIncomingDocs } from "@/hooks/useIncomingDocs"
import { usePermissions } from "@/hooks/usePermissions"
import { useReplyClock } from "@/hooks/useReplyClock"
import { useToast } from "@/hooks/use-toast"
import { lineGive, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { incomingAct } from "@/lib/procurement/incoming-client"
import { workshopQuestions, WORKSHOP_KINDS, type WaitingLine, type WorkshopKind } from "@/lib/procurement/stock-check"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")

export function MfgProcurementAsks() {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { user } = useUser()
  const { can, profile } = usePermissions()
  const orgId = ((profile?.organizationId as string) || user?.uid) ?? null
  const { docs } = useIncomingDocs(orgId)
  const clock = useReplyClock(orgId)
  const rows = useMemo(() => workshopQuestions(docs, clock), [docs, clock])
  const [open, setOpen] = useState<WaitingLine | null>(null)
  if (!rows.length) return null
  const docOf = (r: WaitingLine) => docs.find((d) => d.mrKey === r.mrKey)
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm" aria-label={t("before_mfg_title")}>
      <h2 className="flex items-center gap-2 text-sm font-black">
        <Wrench size={15} aria-hidden="true" /> {t("before_mfg_title")}
      </h2>
      <p className="mb-2 mt-1 text-xs text-muted-foreground">{t("before_mfg_desc")}</p>
      <ul className="divide-y rounded-xl border">
        {rows.map((r) => {
          const ref = docOf(r)?.lines.find((l) => l.no === r.line)?.mk?.ref
          return (
            <li key={`${r.mrKey}#${r.line}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                <p className="text-sm font-bold">
                  <span dir="auto">{r.name}</span>{" "}
                  <span className="tabular-nums" dir="ltr">
                    {qty(r.qty)} {r.unit}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {r.no} · {ref ? t("before_mfg_ref", { price: sarLtr(ref.price.toLocaleString("en-US")), po: ref.po || "—" }) : t("before_ask_ref_none")}
                </p>
              </div>
              <StatusPill tone="warn">{t("before_mfg_until", { date: fmtDay(r.until, locale) })}</StatusPill>
              {can("manufacturing.manage") && (
                <Button size="sm" className="h-8" onClick={() => setOpen(r)}>
                  {t("before_mfg_reply")}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {open && <ReplyDialog key={`${open.mrKey}#${open.line}`} row={open} doc={docOf(open)} onClose={() => setOpen(null)} />}
    </section>
  )
}

function ReplyDialog({ row, doc, onClose }: { row: WaitingLine; doc: IncomingDoc | undefined; onClose: () => void }) {
  const t = useTranslations("Portal.Procurement")
  const { toast } = useToast()
  const [kind, setKind] = useState<WorkshopKind>("make")
  const [make, setMake] = useState("")
  const [wo, setWo] = useState("")
  const [why, setWhy] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const line = doc?.lines.find((l) => l.no === row.line)
  const left = line ? Math.max(0, line.qty - lineGive(line)) : row.qty
  const amount = parseFloat(make)
  const ready = kind === "buy" ? why.trim().length >= 2 : wo.trim().length >= 3 && (kind !== "part" || (amount > 0 && amount < left))

  const send = async () => {
    setBusy(true)
    setError(null)
    const res = await incomingAct({ action: "mfg-reply", mrKey: row.mrKey, line: row.line, kind, make: kind === "part" ? amount : null, wo: kind === "buy" ? null : wo.trim(), why: why.trim() || null })
    setBusy(false)
    if (!res.ok) {
      setError(beforeError(t, res.reason))
      return
    }
    toast({ title: t("before_mfg_saved", { material: row.name }) })
    onClose()
  }

  const chip = (on: boolean) =>
    cn(
      "min-h-9 rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("before_mfg_dialog")}</DialogTitle>
          <DialogDescription>
            <span dir="auto">{row.name}</span> ·{" "}
            <span dir="ltr">
              {qty(left)} {row.unit}
            </span>{" "}
            · <span dir="auto">{row.no}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("before_mfg_dialog")}>
            {WORKSHOP_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)} disabled={busy}>
                {t(`before_mfg_kind_${k}`)}
              </button>
            ))}
          </div>
          {kind === "part" && (
            <div className="space-y-1.5">
              <Label htmlFor="mk-make">{t("before_mfg_make", { qty: qty(left), unit: row.unit })}</Label>
              <Input id="mk-make" type="number" min="0" step="any" dir="ltr" value={make} onChange={(e) => setMake(e.target.value)} disabled={busy} />
            </div>
          )}
          {kind !== "buy" && (
            <div className="space-y-1.5">
              <Label htmlFor="mk-wo">{t("before_mfg_wo")}</Label>
              <Input id="mk-wo" dir="ltr" value={wo} onChange={(e) => setWo(e.target.value)} disabled={busy} maxLength={60} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mk-why">{kind === "buy" ? t("before_mfg_why_buy") : t("before_mfg_why")}</Label>
            <Input id="mk-why" dir="auto" value={why} onChange={(e) => setWhy(e.target.value)} disabled={busy} maxLength={300} />
          </div>
          {error && <Callout tone="warn">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("before_cancel")}
          </Button>
          <Button onClick={() => void send()} disabled={busy || !ready}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("before_mfg_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
