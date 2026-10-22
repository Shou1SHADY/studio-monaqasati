"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Bell, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { linesNet } from "@/lib/procurement/link-pricing"
import { fmtDay, fmtMoney } from "./link-format"
import type { LinkMe, LinkRfqView } from "./link-types"

// «طُلب منك» (LNK-11): what the buyer asked of him, answerable even after the submission closed — one round of a better price
// (never above his current one; his first quote stays on record) and the questions put to his quote.
export function LinkTasks({ tasks, offer, rfq, onBafo, onAnswer }: { tasks: LinkMe["tasks"]; offer: NonNullable<LinkMe["offer"]>; rfq: LinkRfqView; onBafo: (prices: Record<number, string>, total: string) => Promise<boolean>; onAnswer: (id: string, answer: string) => Promise<boolean> }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [total, setTotal] = useState("")
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, true>>({})
  const sar = t("sar")
  if (!tasks.bafo && !tasks.questions.length) return null

  const lineMode = rfq.pricing === "line"
  const valueOf = (index: number, current: number) => (prices[index] ?? String(current))
  const sendBafo = async () => {
    setBusy("bafo")
    const ok = await onBafo(
      Object.fromEntries(offer.lines.map((l) => [l.rfqProductIndex, valueOf(l.rfqProductIndex, l.unitPrice)])),
      total || String(offer.total)
    )
    setBusy(null)
    if (ok) setDone((d) => ({ ...d, bafo: true }))
  }
  const net = lineMode ? linesNet(offer.lines.map((l) => ({ qty: rfq.lines.find((x) => x.index === l.rfqProductIndex)?.qty ?? 0, price: valueOf(l.rfqProductIndex, l.unitPrice), per: l.packLen ?? null }))) : Number(total || offer.total)

  return (
    <section className="space-y-3 rounded-md border bg-card p-3.5" aria-labelledby="link-tasks-title">
      <h2 id="link-tasks-title" className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
        <Bell size={15} className="text-primary" aria-hidden="true" />
        {t("tasks_title")}
        <span className="text-xs font-normal text-muted-foreground">{t("tasks_sub")}</span>
      </h2>

      {tasks.bafo && !done.bafo && (
        <div className="space-y-2.5" data-task="bafo">
          <p className="text-sm font-bold text-foreground">{t("bafo_title", { date: fmtDay(tasks.bafo.replyBy, locale) })}</p>
          {tasks.bafo.note && (
            <p className="text-xs text-muted-foreground" dir="auto">
              {tasks.bafo.note}
            </p>
          )}
          {lineMode ? (
            offer.lines.map((l) => {
              const line = rfq.lines.find((x) => x.index === l.rfqProductIndex)
              return (
                <div key={l.rfqProductIndex} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <div className="min-w-0">
                    <b className="block truncate text-sm" dir="auto">
                      {line?.name}
                    </b>
                    <small className="text-[11px] text-muted-foreground">{t("bafo_current", { price: `${fmtMoney(l.unitPrice, locale)} ${sar}` })}</small>
                  </div>
                  <Input inputMode="decimal" dir="ltr" aria-label={line?.name} value={valueOf(l.rfqProductIndex, l.unitPrice)} onChange={(e) => setPrices((p) => ({ ...p, [l.rfqProductIndex]: e.target.value.replace(/[^\d.,]/g, "") }))} className="h-11 w-28 text-start" />
                </div>
              )
            })
          ) : (
            <div className="flex items-center gap-2">
              <Input inputMode="decimal" dir="ltr" aria-label={t("bafo_current", { price: `${fmtMoney(offer.total, locale)} ${sar}` })} value={total || String(offer.total)} onChange={(e) => setTotal(e.target.value.replace(/[^\d.,]/g, ""))} className="h-11 w-36 text-start" />
              <span className="text-xs text-muted-foreground">{sar}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy !== null || net > offer.total} onClick={() => void sendBafo()} className="min-h-11 gap-1.5">
              {busy === "bafo" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} className="rtl-flip" aria-hidden="true" />}
              {t("bafo_send")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("bafo_hint")}</span>
          </div>
        </div>
      )}
      {done.bafo && (
        <p className="text-xs font-semibold text-success" role="status">
          {t("bafo_done")}
        </p>
      )}

      {tasks.questions
        .filter((q) => !done[q.id])
        .map((q) => (
          <div key={q.id} className="space-y-1.5 rounded-md bg-muted/50 px-3 py-2" data-task="question">
            <b className="block text-sm text-foreground" dir="auto">
              {q.question}
            </b>
            <div className="flex items-center gap-2">
              <Input value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder={t("answer_ph")} aria-label={q.question} maxLength={1000} className="h-11 min-w-0 flex-1" dir="auto" />
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null || !(answers[q.id] || "").trim()}
                onClick={async () => {
                  setBusy(q.id)
                  const ok = await onAnswer(q.id, (answers[q.id] || "").trim())
                  setBusy(null)
                  if (ok) setDone((d) => ({ ...d, [q.id]: true }))
                }}
                className="min-h-11"
              >
                {busy === q.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : t("answer_btn")}
              </Button>
            </div>
          </div>
        ))}
      {tasks.questions.some((q) => done[q.id]) && (
        <p className="text-xs font-semibold text-success" role="status">
          {t("answer_done")}
        </p>
      )}
    </section>
  )
}
