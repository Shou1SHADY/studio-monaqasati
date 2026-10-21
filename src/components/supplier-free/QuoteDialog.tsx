"use client"

// The quote form (PRD OFR-01…05): a price per item with "not supplied", or one total when the contractor asked for it;
// arrival date, validity, a note, a file; net, VAT and gross while typing; the contractor's payment terms in view before
// sending; and the first reason it cannot go in the footer with the count of the others. Opened by its address
// (`?quote=<request>&mode=new|edit|reduce|reval`) so back and reload land on it.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { AlertTriangle, Loader2, Paperclip, Send, Tag, Truck, Wallet, X } from "lucide-react"
import { useStorage, useUser, useFirestore } from "@/firebase"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Link } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"
import { profilePapers } from "@/components/procurement/rfq/rfqOfferView"
import { fromHalalas, lineCalc } from "@/lib/procurement/offer-calc"
import { addDaysTo, r2 } from "@/lib/supplier-free/deal-logic"
import { packLenOf, quoteBlocks, QuoteRefused, submitNewQuote, submitNextVersion, type QuoteMode, type QuoteValues } from "@/lib/supplier-free/quote-writes"
import { uploadSupplierFile } from "@/lib/supplier-free/uploads"
import type { Deal } from "@/lib/supplier-free/types"
import { termsText, useQueryState } from "./ui"
import { useFree } from "./useFree"
import { useQuoteUsage } from "@/hooks/useQuoteUsage"

/** What the server's refusal says to the supplier (it ran the same rules the form shows). */
const REFUSAL_KEY: Record<string, string> = {
  deadline: "blkDeadline",
  rfq_closed: "errRfqClosed",
  reply_closed: "errReplyClosed",
  already_quoted: "errAlreadyQuoted",
  not_reached: "errNotReached",
  not_approved: "errNotApproved",
  quota: "errQuota",
  price_higher: "errPriceHigher",
  not_asked: "errNotAsked",
}

function initialValues(d: Deal, mode: QuoteMode, today: string): QuoteValues {
  const cur = d.offer ? d.offer.v[d.offer.v.length - 1] : null
  if (mode === "new" || !cur) return { prices: {}, skip: {}, total: "", arrive: "", valid: addDaysTo(d.deadline, 14), note: "", packs: {}, warranty: {}, whole: false }
  const prices: Record<string, string> = {}
  const skip: Record<string, boolean> = {}
  const packs: Record<string, string> = {}
  const warranty: Record<string, string> = {}
  for (const i of d.items) {
    const p = cur.prices[i.id]
    prices[i.id] = p != null ? String(p) : ""
    skip[i.id] = p == null
    if (cur.packs?.[i.id]) packs[i.id] = String(cur.packs[i.id])
    if (cur.warranty?.[i.id] != null) warranty[i.id] = String(cur.warranty[i.id])
  }
  // Confirming a price asks for a NEW validity: the old one is what is being replaced.
  const valid = mode === "reval" ? addDaysTo(today, 14) : cur.valid || addDaysTo(today, 14)
  return { prices, skip, total: cur.total != null ? String(cur.total) : "", arrive: cur.arrive || "", valid, note: cur.note || "", packs, warranty, whole: cur.whole === true }
}

/** A deal past quoting (delivering, collecting, done) never opens the quote form. */
export const quoteGuard = (stage: string) => stage === "deliver" || stage === "collect" || stage === "done"

export function QuoteDialog() {
  const f = useFree()
  const q = useQueryState()
  const id = q.get("quote")
  const deal = id ? f.world.deals.find((d) => d.id === id) || null : null
  const wanted = q.get("mode")
  // The prototype's stage guard: an address that asks for a new quote on a quoted request, or any quote once the deal is
  // awarded, opens the deal instead of the form.
  const guarded = !!deal && (quoteGuard(f.L.stage(deal)) || (wanted === "new" && !!deal.offer))
  const setQuery = q.set
  const dealId = deal?.id || ""
  useEffect(() => {
    if (guarded) setQuery({ quote: null, mode: null, deal: dealId }, { replace: true })
  }, [guarded, dealId, setQuery])
  if (!deal || guarded) return null
  const mode: QuoteMode = deal.offer ? (wanted === "reduce" && deal.offer.reduce ? "reduce" : wanted === "reval" && deal.offer.reval ? "reval" : "edit") : "new"
  return <Form key={`${deal.id}:${mode}`} f={f} d={deal} mode={mode} onClose={() => q.set({ quote: null, mode: null })} onDone={(dealId) => q.set({ quote: null, mode: null, deal: dealId }, { replace: true })} />
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
  // The company's own rate (15% with a VAT number, else 0) — the one the server stores on the version and on his invoices.
  const vatOn = L.vatRate > 0
  const check = useMemo(() => quoteBlocks(d, v, mode, L, L.vatRate), [d, v, mode, L])
  const vat = check.vat
  const gross = check.gross
  useEffect(() => {
    const el = document.getElementById("quote-first-input")
    if (el) setTimeout(() => (el as HTMLInputElement).focus(), 80)
  }, [])

  const cur = d.offer ? d.offer.v[d.offer.v.length - 1] : null
  const terms = d.terms || d.po?.terms
  const reduce = mode === "reduce" && d.offer?.reduce ? d.offer.reduce : null

  const blockText = (b: (typeof check.blocks)[number]) => (b.item !== undefined ? t(`blk${b.code[0].toUpperCase()}${b.code.slice(1)}` as "blkZero", { i: b.item }) : t(`blk${b.code[0].toUpperCase()}${b.code.slice(1)}` as "blkTotal"))
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
        await submitNextVersion(ctx, offer.id, v, mode)
        toast({ title: t("tVersionSent", { n: (d.offer?.v.length || 1) + 1 }) })
      }
      onDone(d.id)
    } catch (err) {
      console.error("quote", err)
      const key = err instanceof QuoteRefused ? REFUSAL_KEY[err.code] : undefined
      toast({ title: t((key || "errSave") as "errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  // No quotation before the platform approves the company (onboarding) — said here, refused again by the server.
  const notApproved = mode === "new" && !!f.profile && !f.profile.isVerified
  // The free plan's monthly allowance, when the admin set one — shown before he fills the form, refused by the server too.
  const usage = useQuoteUsage(user, mode === "new" && !notApproved)
  const quotaLeft = usage && usage.limit != null ? Math.max(0, usage.limit - usage.used) : null
  const quotaUsed = quotaLeft === 0
  const titleKey = mode === "reduce" ? "ofReduceT" : mode === "reval" ? "ofRevalT" : mode === "edit" ? "ofEditT" : "ofNewT"
  const when = reduce ? t("ofReplyBy", { x: fmt.date(reduce.by), r: rel(reduce.by) }) : `${t("fDeadline")}: ${fmt.date(d.deadline)} (${rel(d.deadline)})`
  const input = "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"  // the shared Input's look (16px on phones: no zoom on focus)

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
            {notApproved && (
              <Callout tone="block" title={t("apprNeedT")}>
                {t("apprNeedB")}{" "}
                <Link href="/supplier/profile?tab=legal" className="font-semibold underline underline-offset-2">
                  {t("apprGo")}
                </Link>
              </Callout>
            )}
            {usage && usage.limit != null && (
              <Callout tone={quotaUsed ? "block" : "info"}>{quotaUsed ? t("errQuota") : t("quotaLeft", { used: fmt.n(usage.used), limit: fmt.n(usage.limit) })}</Callout>
            )}
            {reduce && (
              <Callout tone="warn">
                <b>{reduce.target > 0 ? t("ofReduceBanner", { v: fmt.money(reduce.target), cur: fmt.money(L.offerTotal(d)), d: fmt.money(r2(L.offerTotal(d) - reduce.target)) }) : t("ofBetterBanner", { cur: fmt.money(L.offerTotal(d)) })}</b>
                {reduce.note && <span> «{reduce.note}»</span>} {t("ofReduceHint")}
              </Callout>
            )}
            {mode === "reval" && <Callout tone="warn">{t("ofRevalBanner")}</Callout>}
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
                    const pack = packLenOf(i, v)
                    const calc = check.packs[i.id]
                    const packName = pack != null ? (i.packs || []).find((u) => u.len === pack)?.name || "" : ""
                    const warrantyOptions = i.warranty ? [...new Set([i.warranty, 12, 6, 0].filter((m) => m <= (i.warranty as number)))].sort((x, y) => y - x) : []
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
                        {!skipped && (i.packs?.length || 0) > 0 && (
                          <span className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2">
                            <label htmlFor={"pack-" + i.id} className="font-semibold text-muted-foreground">
                              {t("ofPackLbl")}
                            </label>
                            <NativeSelect
                              id={"pack-" + i.id}
                              value={v.packs?.[i.id] ?? ""}
                              onChange={(e) => set({ packs: { ...v.packs, [i.id]: e.target.value } })}
                              className="h-8 rounded-md px-2 text-xs"
                            >
                              <option value="">{t("ofPackPerUnit", { unit: i.unit })}</option>
                              {(i.packs || []).map((u) => (
                                <option key={u.len} value={String(u.len)}>
                                  {t("ofPackPerPiece", { name: u.name })}
                                </option>
                              ))}
                            </NativeSelect>
                          </span>
                        )}
                        {!skipped && calc && (
                          <span className="rounded-lg bg-cta/10 px-2.5 py-1.5 text-xs font-semibold text-cta sm:col-span-2" aria-live="polite">
                            {t("ofPackLive", { pcs: f.fmt.n(calc.pcs), name: packName, received: f.fmt.n(calc.received), unit: i.unit, total: fmt.money(fromHalalas(lineCalc(i.qty, Number(v.prices[i.id]) || 0, pack).totalH)) })}
                            {calc.extra > 0 ? " · " + t("ofPackExtra", { extra: f.fmt.n(calc.extra), unit: i.unit }) : ""}
                          </span>
                        )}
                        {!skipped && i.warranty != null && (
                          <span className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2">
                            <label htmlFor={"warranty-" + i.id} className="font-semibold text-muted-foreground">
                              {t("ofWarrantyLbl", { months: i.warranty })}
                            </label>
                            <NativeSelect
                              id={"warranty-" + i.id}
                              value={v.warranty?.[i.id] ?? ""}
                              onChange={(e) => set({ warranty: { ...v.warranty, [i.id]: e.target.value } })}
                              className="h-8 rounded-md px-2 text-xs"
                            >
                              <option value="">{t("ofWarrantyPick")}</option>
                              {warrantyOptions.map((m) => (
                                <option key={m} value={String(m)}>
                                  {m === 0 ? t("ofWarrantyNone") : [6, 12, 24, 36, 60].includes(m) ? t(`ofWarrantyM${m}` as "ofWarrantyM6") : t("ofWarrantyOpt", { months: m })}
                                </option>
                              ))}
                            </NativeSelect>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {d.pricing !== "total" && (
                <label className="mt-3 flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <input type="checkbox" checked={!!v.whole} onChange={(e) => set({ whole: e.target.checked })} className="mt-0.5 h-4 w-4" />
                  <span>
                    <b className="block">{t("ofWhole")}</b>
                    <span className="text-xs text-muted-foreground">{t("ofWholeHint")}</span>
                  </span>
                </label>
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
            <p className="min-w-0 flex-1 max-sm:basis-full text-xs font-semibold text-destructive" role="status">
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
            <Button type="submit" disabled={check.blocks.length > 0 || busy || notApproved || quotaUsed}>
              {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Send size={15} className="me-1.5" aria-hidden="true" />}
              {t(mode === "new" ? "btnSendOffer" : "btnSendVersion")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
