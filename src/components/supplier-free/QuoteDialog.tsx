"use client"

// The quote form (PRD OFR-01…05): a price per item with "not supplied", or one total when the contractor asked for it;
// arrival date, validity, a note, a file; net, VAT and gross while typing; the contractor's payment terms in view before
// sending; and the first reason it cannot go in the footer with the count of the others. Opened by its address
// (`?quote=<request>&mode=new|edit|reduce`) so back and reload land on it.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { AlertTriangle, Loader2, Paperclip, Send, Tag, Truck, Wallet, X } from "lucide-react"
import { useStorage, useUser, useFirestore } from "@/firebase"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import { profilePapers } from "@/components/procurement/rfq/rfqOfferView"
import { addDaysTo, r2 } from "@/lib/supplier-free/deal-logic"
import { quoteBlocks, submitNewQuote, submitNextVersion, type QuoteMode, type QuoteValues } from "@/lib/supplier-free/quote-writes"
import { uploadSupplierFile } from "@/lib/supplier-free/uploads"
import type { Deal } from "@/lib/supplier-free/types"
import { termsText, useQueryState } from "./ui"
import { useFree } from "./useFree"

function initialValues(d: Deal, mode: QuoteMode, today: string): QuoteValues {
  const cur = d.offer ? d.offer.v[d.offer.v.length - 1] : null
  if (mode === "new" || !cur) return { prices: {}, skip: {}, total: "", arrive: "", valid: addDaysTo(d.deadline, 14), note: "", }
  const prices: Record<string, string> = {}
  const skip: Record<string, boolean> = {}
  for (const i of d.items) {
    const p = cur.prices[i.id]
    prices[i.id] = p != null ? String(p) : ""
    skip[i.id] = p == null
  }
  return { prices, skip, total: cur.total != null ? String(cur.total) : "", arrive: cur.arrive || "", valid: cur.valid || addDaysTo(today, 14), note: cur.note || "" }
}

export function QuoteDialog() {
  const f = useFree()
  const q = useQueryState()
  const id = q.get("quote")
  const deal = id ? f.world.deals.find((d) => d.id === id) || null : null
  if (!deal) return null
  const wanted = q.get("mode")
  const mode: QuoteMode = deal.offer ? (wanted === "reduce" && deal.offer.reduce ? "reduce" : "edit") : "new"
  return <Form key={`${deal.id}:${mode}`} f={f} d={deal} mode={mode} onClose={() => q.set({ quote: null, mode: null })} onDone={(dealId) => q.set({ quote: null, mode: null, deal: dealId })} />
}

function Form({ f, d, mode, onClose, onDone }: { f: ReturnType<typeof useFree>; d: Deal; mode: QuoteMode; onClose: () => void; onDone: (id: string) => void }) {
  const { t, L, today, profile, fmt, pl, rel, rawRfq, rawOffer } = f
  const { toast } = useToast()
  const firestore = useFirestore()
  const storage = useStorage()
  const { user } = useUser()
  const [v, setV] = useState<QuoteValues>(() => initialValues(d, mode, today))
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const c = L.C(d.c)
  const vatOn = !!(profile && String(profile.raw.taxNumber || "").trim())
  const check = useMemo(() => quoteBlocks(d, v, mode, L), [d, v, mode, L])
  const vat = vatOn ? check.vat : 0
  const gross = r2(check.net + vat)
  useEffect(() => {
    const el = document.getElementById("quote-first-input")
    if (el) setTimeout(() => (el as HTMLInputElement).focus(), 80)
  }, [])

  const cur = d.offer ? d.offer.v[d.offer.v.length - 1] : null
  const terms = d.terms || d.po?.terms
  const reduce = mode === "reduce" && d.offer?.reduce ? d.offer.reduce : null

  const blockText = (b: (typeof check.blocks)[number]) => (b.code === "zero" ? t("blkZero", { i: b.item || "" }) : t(`blk${b.code[0].toUpperCase()}${b.code.slice(1)}` as "blkTotal"))
  const set = (patch: Partial<QuoteValues>) => setV((x) => ({ ...x, ...patch }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (check.blocks.length || busy || !firestore || !user || !profile) return
    const rfq = rawRfq(d.id)
    if (!rfq) return
    setBusy(true)
    try {
      let fileUrl: string | null = null
      if (file && storage) fileUrl = (await uploadSupplierFile(storage, profile.orgId, "quotes", file)).url
      const ctx = {
        firestore,
        uid: user.uid,
        orgId: profile.orgId,
        userName: profile.name || user.email || "",
        companyName: profile.companyName,
        today,
        rfq,
        deal: d,
        papers: profilePapers((profile.raw.legalDocuments as never) || null),
        fileUrl,
        side: { company: profile.companyName, actor: { uid: user.uid, name: profile.name || user.email || "" } },
      }
      if (mode === "new") {
        await submitNewQuote(ctx, v)
        toast({ title: t("tOfferSent", { c: c?.name || "" }) })
      } else {
        const offer = rawOffer(d.id)
        if (!offer) throw new Error("no offer")
        await submitNextVersion(ctx, offer.id, v, mode, offer)
        toast({ title: t("tVersionSent", { n: (d.offer?.v.length || 1) + 1 }) })
      }
      onDone(d.id)
    } catch (err) {
      console.error("quote", err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const titleKey = mode === "reduce" ? "ofReduceT" : mode === "edit" ? "ofEditT" : "ofNewT"
  const when = reduce ? t("ofReplyBy", { x: fmt.date(reduce.by), r: rel(reduce.by) }) : `${t("fDeadline")}: ${fmt.date(d.deadline)} (${rel(d.deadline)})`
  const input = "h-10 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl gap-0 overflow-hidden p-0" aria-describedby="quote-desc">
        <form onSubmit={submit} noValidate className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b px-5 py-4 text-start">
            <DialogTitle className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-cta/10 text-cta">
                <Send size={16} aria-hidden="true" />
              </span>
              {t(titleKey)}
            </DialogTitle>
            <DialogDescription id="quote-desc" dir="auto">
              <bdi>{d.title}</bdi> · <bdi>{c?.name}</bdi> · {when}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {reduce && (
              <Callout tone="warn">
                <b>{t("ofReduceBanner", { v: fmt.money(reduce.target), cur: fmt.money(L.offerTotal(d)), d: fmt.money(r2(L.offerTotal(d) - reduce.target)) })}</b>
                {reduce.note && <span> «{reduce.note}»</span>} {t("ofReduceHint")}
              </Callout>
            )}
            {terms && (
              <Callout tone="info">
                <span className="inline-flex items-start gap-1.5">
                  <Wallet size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {t("ofTermsLine", { c: c?.name || "", x: termsText(f, terms) })}
                </span>
              </Callout>
            )}
            {d.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {d.files.map((fl, i) => (
                  <a key={i} href={fl.url || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1 text-xs">
                    <Paperclip size={13} aria-hidden="true" />
                    <bdi>{fl.n}</bdi>
                    {fl.s && <small className="text-muted-foreground">{fl.s}</small>}
                  </a>
                ))}
              </div>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                <Tag size={15} className="text-cta" aria-hidden="true" />
                {t("ofPricesT")} <span className="text-xs font-normal text-muted-foreground">{t(d.pricing === "total" ? "prTotal" : "prItem")}</span>
              </h3>
              {d.pricing === "total" ? (
                <div className="space-y-3">
                  <Callout tone="info">{t("ofTotalInfo")}</Callout>
                  <ul className="divide-y rounded-lg border">
                    {d.items.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>
                          <b>
                            <bdi>{i.name}</bdi>
                          </b>
                          {i.spec && <span className="block text-xs text-muted-foreground">{i.spec}</span>}
                        </span>
                        <b className="whitespace-nowrap tabular-nums" dir="ltr">
                          {f.fmt.n(i.qty)} {i.unit}
                        </b>
                      </li>
                    ))}
                  </ul>
                  <label className="block text-sm font-semibold">
                    {t("prTotalLbl")} <span className="text-destructive">*</span>
                    <input id="quote-first-input" className={`${input} mt-1`} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={v.total} onChange={(e) => set({ total: e.target.value })} />
                  </label>
                </div>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {d.items.map((i, n) => {
                    const skipped = !!v.skip[i.id]
                    return (
                      <li key={i.id} className="grid items-center gap-2 px-3 py-2.5 sm:grid-cols-[1fr_auto]">
                        <span className="min-w-0 text-sm">
                          <b>
                            <bdi>{i.name}</bdi>
                          </b>
                          <span className="block text-xs text-muted-foreground">
                            <span dir="ltr">
                              {f.fmt.n(i.qty)} {i.unit}
                            </span>
                            {i.spec && ` · ${i.spec}`}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <input
                            id={n === 0 ? "quote-first-input" : undefined}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            dir="ltr"
                            placeholder="0.00"
                            disabled={skipped}
                            value={v.prices[i.id] ?? ""}
                            onChange={(e) => set({ prices: { ...v.prices, [i.id]: e.target.value } })}
                            aria-label={`${t("thUnitPrice")} — ${i.name}`}
                            className="h-9 w-28 rounded-lg border bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                          />
                          <span className="w-24 text-end text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">
                            {check.lines[i.id] != null ? fmt.money(check.lines[i.id] as number) : "—"}
                          </span>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input type="checkbox" checked={skipped} onChange={(e) => set({ skip: { ...v.skip, [i.id]: e.target.checked } })} className="h-4 w-4" />
                            {t("notSupplied")}
                          </label>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <dl className="mt-3 space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("sumNet")}</dt>
                  <dd className="font-bold tabular-nums" dir="ltr">
                    {fmt.money(check.net)}
                  </dd>
                </div>
                {vatOn && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("sumVat")}</dt>
                    <dd className="font-bold tabular-nums" dir="ltr">
                      {fmt.money(vat)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 text-base">
                  <dt className="font-bold">{t("sumGross")}</dt>
                  <dd className="font-black tabular-nums" dir="ltr">
                    {fmt.money(gross)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Truck size={15} className="text-cta" aria-hidden="true" />
                {t("ofSupplyT")}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  {t("fArrive")}
                  <input type="date" className={`${input} mt-1`} value={v.arrive} onChange={(e) => set({ arrive: e.target.value })} />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("ofArriveHint", { x: fmt.date(d.needBy, true) })}</span>
                </label>
                <label className="block text-sm font-semibold">
                  {t("fValid")} <span className="text-destructive">*</span>
                  <input type="date" className={`${input} mt-1`} value={v.valid} onChange={(e) => set({ valid: e.target.value })} />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("ofValidHint")}</span>
                </label>
              </div>
              <label className="block text-sm font-semibold">
                {t("fNote")}
                <textarea rows={3} maxLength={1000} placeholder={t("ofNotePh")} className={`${input} mt-1 h-auto py-2`} value={v.note} onChange={(e) => set({ note: e.target.value })} />
              </label>
              <div>
                <p className="mb-1 text-sm font-semibold">{t("fAttach")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept="application/pdf,image/*" className="sr-only" id="quote-file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <label htmlFor="quote-file" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50">
                    <Paperclip size={14} aria-hidden="true" />
                    {t("chooseFile")}
                  </label>
                  <span className="text-xs text-muted-foreground" dir="auto">
                    {file ? file.name : cur?.file ? t("fileKept") : t("noFile")}
                  </span>
                  {file && (
                    <button
                      type="button"
                      aria-label={t("close")}
                      onClick={() => {
                        setFile(null)
                        if (fileRef.current) fileRef.current.value = ""
                      }}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("ofAttachHint")}</p>
              </div>
            </section>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-5 py-3">
            <p className="min-w-0 flex-1 text-xs font-semibold text-destructive" role="status">
              {check.blocks.length > 0 && (
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {blockText(check.blocks[0])}
                    {check.blocks.length > 1 && <span className="font-normal text-muted-foreground"> · {t("plusMore", { n: pl("pl_more", check.blocks.length - 1) })}</span>}
                  </span>
                </span>
              )}
            </p>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={check.blocks.length > 0 || busy} className="bg-cta text-cta-foreground hover:bg-cta/90">
              {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Send size={15} className="me-1.5" aria-hidden="true" />}
              {t(mode === "new" ? "btnSendOffer" : "btnSendVersion")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
