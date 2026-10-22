"use client"

// «الاستفسارات» (QA-01…04, WF-11): the supplier's questions from the portal or the visitors' link — who asked (or nobody),
// when, about which material — the unanswered ones shaded; an answer «للجميع» (every invitee and the link read it, without the
// asker's name) or «للسائل فقط» (a nameless question can only be answered for everyone); a clarification of ours to every
// invitee; and, when a question changes the scope, «مدّد الموعد». All writes are the server's.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, Link2, Loader2, MessageCircleQuestion, Pencil, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Textarea } from "@/components/ui/textarea"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useDateText } from "@/components/procurement/PoBits"
import { useToast } from "@/hooks/use-toast"
import type { RfqWorld } from "@/hooks/useRfqWorld"
import { InquiryRefused, sendInquiryAct } from "@/lib/procurement/rfq-inquiries-client"
import { INQUIRY_TEXT_MAX, answerOf, createdIso, inquiryKind, inquiryOrder, isAnonymous, needsAnswer, publicQuestion, type AnswerScope, type InquiryDoc } from "@/lib/procurement/rfq-inquiries"
import { cn } from "@/lib/utils"

type Row = InquiryDoc & { id: string }

export function RfqInquiriesTab({ world, onExtend }: { world: RfqWorld; onExtend: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqpage.qa")
  const date = useDateText()
  const { toast } = useToast()
  const { rfq, access } = world
  const rfqId = world.rfqId
  const canAct = access.acts
  const open = rfq?.status === "New"
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [wording, setWording] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState("")

  const rows = inquiryOrder(world.inquiries as Row[])
  const materialOf = (q: Row) => (q.li != null ? (rfq?.products?.[q.li]?.name || "").trim() : "")

  const fail = (err: unknown) => {
    const code = err instanceof InquiryRefused ? err.code : "INTERNAL"
    toast({ title: t.has(`err.${code}`) ? t(`err.${code}`) : t("err.generic"), variant: "destructive" })
  }

  const answer = async (q: Row, scope: AnswerScope) => {
    const text = (texts[q.id] || "").trim()
    if (!text) return
    setBusy(q.id)
    try {
      const edited = wording[q.id]
      const out = await sendInquiryAct({ action: "answer", rfqId, inquiryId: q.id, text, scope, ...(scope === "all" && edited != null && edited.trim() ? { question: edited.trim() } : {}) })
      toast({ title: scope === "all" ? t("sent_all", { count: out.told }) : t("sent_asker") })
      setTexts((p) => ({ ...p, [q.id]: "" }))
      setWording((p) => ({ ...p, [q.id]: null }))
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const sendNote = async () => {
    if (!note.trim()) return
    setBusy("note")
    try {
      const out = await sendInquiryAct({ action: "note", rfqId, text: note.trim() })
      toast({ title: t("note_sent", { count: out.told }) })
      setNote("")
      setNoteOpen(false)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {canAct && open && (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-2xl text-xs text-muted-foreground">{t("caption")}</p>
            {!noteOpen && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setNoteOpen(true)}>
                <Send size={14} aria-hidden="true" />
                {t("note_button")}
              </Button>
            )}
          </div>
          {noteOpen && (
            <div className="space-y-2">
              <Textarea aria-label={t("note_button")} value={note} maxLength={INQUIRY_TEXT_MAX} rows={3} placeholder={t("note_ph")} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button type="button" size="sm" className="gap-2" onClick={sendNote} disabled={!note.trim() || busy === "note"}>
                  {busy === "note" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  {t("note_submit")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => (setNoteOpen(false), setNote(""))}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={MessageCircleQuestion} title={t("empty_title")} description={t("empty")} />
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => {
            const kind = inquiryKind(q)
            const a = answerOf(q)
            const waiting = needsAnswer(q)
            const anon = isAnonymous(q)
            const via = q.via === "link" || (anon && !q.organizationId)
            const material = materialOf(q)
            const asker = anon ? t("visitor") : q.supplierName || q.submittedByUserName || t("supplier")
            const edited = wording[q.id]
            return (
              <li key={q.id} data-inquiry={q.id} data-state={waiting ? "waiting" : "answered"} className={cn("rounded-xl border bg-card p-3 text-sm", waiting && "border-warning/40 bg-warning/5")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {kind === "ask" && (
                    <>
                      <span className="font-black" dir="auto">{asker}</span>
                      {via && (
                        <StatusPill tone="violet" className="gap-1">
                          <Link2 size={10} aria-hidden="true" />
                          {t("pill_link")}
                        </StatusPill>
                      )}
                    </>
                  )}
                  {kind === "our_question" && <span className="font-black" dir="auto">{t("ours_to", { name: q.supplierName || t("supplier") })}</span>}
                  {kind === "note" && <span className="font-black">{t("ours_all")}</span>}
                  <span className="text-muted-foreground">{date(createdIso(q))}</span>
                  {material && <span className="text-muted-foreground" dir="auto">{t("about", { material })}</span>}
                </div>

                {kind !== "note" && (
                  <p className="mt-1.5 leading-relaxed" dir="auto">
                    {publicQuestion(q)}
                  </p>
                )}
                {kind === "note" && (
                  <p className="mt-1.5 leading-relaxed" dir="auto">
                    {q.question}
                  </p>
                )}

                {a && kind !== "note" && (
                  <div className="mt-2 rounded-lg border border-success/20 bg-success/5 p-2.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-success">
                      <CheckCircle2 size={13} aria-hidden="true" />
                      {kind === "our_question" ? t("his_answer") : a.all ? t("answered_all") : t("answered_asker")}
                      {a.at && <span className="font-normal text-success/80">{date(a.at)}</span>}
                    </p>
                    <p className="mt-0.5" dir="auto">{a.text}</p>
                  </div>
                )}

                {kind === "our_question" && !a && <p className="mt-1.5 text-xs font-semibold text-muted-foreground">{t("awaiting_him")}</p>}

                {waiting && canAct && (
                  <div className="mt-2 space-y-2">
                    {edited != null && (
                      <div className="space-y-1">
                        <Textarea aria-label={t("edit_wording")} value={edited} maxLength={INQUIRY_TEXT_MAX} rows={2} onChange={(e) => setWording((p) => ({ ...p, [q.id]: e.target.value }))} />
                        <p className="text-[11px] text-muted-foreground">{t("edit_hint")}</p>
                      </div>
                    )}
                    <Textarea
                      aria-label={t("answer_label")}
                      value={texts[q.id] || ""}
                      maxLength={INQUIRY_TEXT_MAX}
                      rows={3}
                      placeholder={t("answer_ph")}
                      onChange={(e) => setTexts((p) => ({ ...p, [q.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" className="gap-2" disabled={!(texts[q.id] || "").trim() || busy === q.id} onClick={() => answer(q, "all")}>
                        {busy === q.id && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        {t("answer_all")}
                      </Button>
                      {!anon && (
                        <Button type="button" size="sm" variant="outline" disabled={!(texts[q.id] || "").trim() || busy === q.id} onClick={() => answer(q, "asker")}>
                          {t("answer_asker")}
                        </Button>
                      )}
                      {edited == null && (
                        <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setWording((p) => ({ ...p, [q.id]: publicQuestion(q) }))}>
                          <Pencil size={12} aria-hidden="true" />
                          {t("edit_wording")}
                        </Button>
                      )}
                      <button type="button" onClick={onExtend} className="rounded-sm text-xs font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t("extend_hint")}
                      </button>
                    </div>
                    {anon && <p className="text-[11px] text-muted-foreground">{t("anon_all_only")}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!canAct && rows.some(needsAnswer) && <Callout tone="info">{t("read_only")}</Callout>}
    </div>
  )
}
