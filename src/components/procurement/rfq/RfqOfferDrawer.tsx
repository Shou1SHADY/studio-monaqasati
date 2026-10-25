"use client"

// «لوح العرض» (RFQ-07, CMP-18): one offer in full — totals and coverage, who he is, his prices line by line with the effective
// price per request unit, his terms, what we asked him, and what happened to the offer — and the acts on it. Every act is the
// server's (`decideOffer`); the award is the review's, opened through `onAward`.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Ban, CheckCircle2, MailQuestion, RotateCcw, ShieldAlert, Star, TrendingDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { Money, useDateText } from "@/components/procurement/PoBits"
import type { AwardSelection, RfqWorld } from "@/hooks/useRfqWorld"
import { awardSupplierOrgId } from "@/lib/procurement/award"
import { fromHalalas, lineOf, pricedProducts } from "@/lib/procurement/offer-calc"
import { bafoOf } from "@/lib/procurement/offer-decisions"
import { currentNote, offerHistory, priceConfirmed, type OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import { warrantyAskedOf } from "@/lib/procurement/offer-versions"
import { inquiryKind, answerOf, publicQuestion } from "@/lib/procurement/rfq-inquiries"
import { rfqDisplayNumber } from "@/lib/procurement/format"
import { cn } from "@/lib/utils"
import { OfferTags } from "./OfferTags"
import { OffPlatformBox } from "./OffPlatformBox"
import { useTermsText } from "./rfqOfferText"
import { SupplierLink } from "../SupplierLink"
import type { RfqOfferView } from "./rfqOfferView"

export interface DrawerActions {
  onAward: (sel: AwardSelection) => void
  onToggleShortlist: (row: OfferRowModel) => void
  onClarify: (row: OfferRowModel) => void
  onBafo: (row: OfferRowModel) => void
  onReval: (row: OfferRowModel) => void
  onExclude: (row: OfferRowModel) => void
  onRestore: (row: OfferRowModel) => void
  onInvite: (row: OfferRowModel) => void
  onSample: (row: OfferRowModel) => void
}

function Box({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card px-3 py-2", tone)}>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="text-sm font-black">{children}</div>
    </div>
  )
}

export function RfqOfferDrawer({ row, world, actions, onClose, fallbackName }: { row: OfferRowModel | null; world: RfqWorld; actions: DrawerActions; onClose: () => void; fallbackName: string }) {
  const t = useTranslations("Portal.Procurement.rfqpage.drawer")
  const tl = useTranslations("Portal.Procurement.rfqpage.list")
  const th = useTranslations("Portal.Procurement.rfqpage.history")
  const locale = useLocale()
  const date = useDateText()
  const termsText = useTermsText()
  const { rfq, access, today } = world

  return (
    <Sheet open={row != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} dir={locale === "ar" ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {row && rfq && <DrawerBody />}
      </SheetContent>
    </Sheet>
  )

  function DrawerBody() {
    const r = row as OfferRowModel
    const offer = r.offer as RfqOfferView & { supplierNote?: string | null }
    const ev = r.ev
    const name = r.name || fallbackName
    const orgId = awardSupplierOrgId(r.offer as never)
    const profile = orgId ? world.profiles[orgId] : null
    const exp = world.experienceOf(orgId)
    const verified = world.verifiedOf ? world.verifiedOf(orgId) : false
    const guest = r.origin === "guest"
    const out = r.excluded || r.withdrawn || r.declined
    const open = world.state.stage === "open" || world.state.stage === "compare"
    const products = pricedProducts(rfq)
    const terms = termsText(offer)
    const bafo = bafoOf(r.offer)
    const record = world.decisionRecords.find((d) => d.id === r.id)
    const history = offerHistory(r, record?.log)
    const mine = world.inquiries.filter((q) => (inquiryKind(q) === "our_question" && q.to?.offerId === r.id) || (inquiryKind(q) === "ask" && orgId && q.organizationId === orgId))
    const note = currentNote(r.offer) || (offer.supplierNote || "").trim() || ((offer as { guestReplyNote?: string }).guestReplyNote || "") || ""
    const canAct = access.acts && open && !out && !r.awarded
    const canAward = access.canDecide && open && !out && !r.awarded && !ev.expired && ev.netH != null

    return (
      <>
        <SheetHeader className="space-y-1 border-b px-4 py-4 text-start">
          <div className="flex flex-wrap items-center gap-1.5">
            {r.rank && <StatusPill tone={r.rank === 1 ? "warn" : "mute"}>{`#${r.rank}`}</StatusPill>}
            <StatusPill tone={guest ? "warn" : verified ? "ok" : "info"}>{guest ? tl("off_platform") : r.origin === "mdmak" ? tl("mdmak") : verified ? tl("docs_verified") : tl("docs_unverified")}</StatusPill>
            <OfferTags row={{ tags: r.tags.filter((x) => x.code === "awarded" || x.code === "excluded") }} />
          </div>
          <SheetTitle className="text-lg font-black" dir="auto">
            {name}
          </SheetTitle>
          <SheetDescription dir="auto">
            <bdi>{rfqDisplayNumber(rfq as { rfqNumber?: string | null }, locale)}</bdi> · {rfq?.title}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 px-4 py-4">
          <div className="grid grid-cols-3 gap-2">
            <Box label={ev.vatRate > 0 ? t("total_incl") : t("total_no_vat")}>
              {world.access.seesPrices && r.grossH != null ? <Money value={fromHalalas(r.grossH)} /> : "—"}
              {world.access.seesPrices && r.netH != null && ev.vatRate > 0 && <span className="block text-[10px] font-medium text-muted-foreground">{t("before_vat")} <Money value={fromHalalas(r.netH)} /></span>}
              {world.access.seesPrices && r.previousGrossH != null && <span className="block text-[10px] font-medium text-muted-foreground line-through"><Money value={fromHalalas(r.previousGrossH)} /></span>}
            </Box>
            <Box label={t("priced")}>{ev.partial ? t("priced_n", { covered: r.coverage.covered, of: r.coverage.of }) : t("priced_all")}</Box>
            <Box label={t("lead")}>
              {r.leadDays != null ? t("lead_days", { days: r.leadDays }) : "—"}
              {r.leadDays != null && <span className="block text-[10px] font-medium text-muted-foreground">{t("lead_from")}</span>}
            </Box>
          </div>

          {ev.expired && (
            <Callout tone="warn">{t("expired_note")}</Callout>
          )}

          {guest ? (
            <OffPlatformBox row={r} rfqTitle={rfq?.title || ""} today={today} canAct={access.acts} inOurs={Boolean(orgId && world.records.has(orgId))} onInvite={() => actions.onInvite(r)} />
          ) : (
            <DrawerSection title={t("supplier")} defaultOpen>
              {/* SP-03: his file opens over this drawer and closes back to it, instead of leaving the RFQ. */}
              <SupplierLink orgId={orgId} name={name} className="font-bold" />
              {profile?.city && <KeyValueRow label={t("city")} value={profile.city} />}
              <KeyValueRow label={t("our_experience")} value={exp.orders ? t("our_orders", { count: exp.orders }) : t("new_supplier")} />
              {exp.onTimePercent != null && <KeyValueRow label={t("commitment")} value={`${exp.onTimePercent}%`} ltr />}
              {profile?.rating != null && <KeyValueRow label={t("rating")} value={<span className="inline-flex items-center gap-1" dir="ltr"><Star size={12} className="fill-warning text-warning" aria-hidden="true" />{profile.rating}</span>} />}
            </DrawerSection>
          )}

          <DrawerSection title={t("prices")} count={products.length}>
            <div className="divide-y text-sm">
              {products.map((p) => {
                const line = lineOf(ev, p.rfqProductIndex)
                const warrantyMonths = (r.offer.lines || []).find((l) => Number(l.rfqProductIndex) === p.rfqProductIndex)?.warrantyMonths
                const asked = warrantyAskedOf(rfq?.products?.[p.rfqProductIndex] as Parameters<typeof warrantyAskedOf>[0])
                const short = asked != null && warrantyMonths != null && Number(warrantyMonths) < asked
                const star = !out && ev.kind !== "lump" && Boolean(world.evaluation.lines.find((l) => l.rfqProductIndex === p.rfqProductIndex)?.lowestIds.includes(r.id))
                return (
                  <div key={p.rfqProductIndex} className="space-y-0.5 py-2" data-line={p.rfqProductIndex}>
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold" dir="auto">
                      <span>{p.name}</span>
                      {star && world.access.seesPrices && line && (
                        <StatusPill tone="ok">
                          <Star size={10} className="fill-current" aria-hidden="true" />
                          {t("line_lowest")}
                        </StatusPill>
                      )}
                    </p>
                    {!world.access.seesPrices ? (
                      <p className="text-muted-foreground">—</p>
                    ) : line ? (
                      <>
                        <p className="flex flex-wrap items-baseline justify-between gap-x-3 tabular-nums">
                          <span dir="ltr">
                            <Money value={fromHalalas(line.rateH)} /> {line.pack ? t("per_piece") : `/ ${p.unit}`}
                          </span>
                          <span className="font-black"><Money value={fromHalalas(line.totalH)} /></span>
                        </p>
                        {line.pack && (
                          <p className="text-[11px] text-muted-foreground" dir="auto">
                            {t("pack_line", { pcs: line.pack.pcs, len: line.pack.packLen, received: line.pack.received, extra: line.pack.extra, unit: p.unit })}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {t("effective")} <Money value={fromHalalas(line.effH)} /> / {p.unit}
                          {line.pack?.perReceivedH != null && <> · {t("per_received")} <Money value={fromHalalas(line.pack.perReceivedH)} /></>}
                          {warrantyMonths != null && (
                            <>
                              {" · "}
                              <span className={cn(short && "inline-flex items-center gap-1 font-bold text-destructive")} data-warranty={short ? "short" : "ok"}>
                                {short && <ShieldAlert size={11} aria-hidden="true" />}
                                {warrantyMonths === 0 ? tl("warranty_none") : t("warranty_months", { months: warrantyMonths })}
                                {short && ` — ${t("warranty_asked", { months: asked ?? 0 })}`}
                              </span>
                            </>
                          )}
                        </p>
                      </>
                    ) : ev.kind === "lump" ? (
                      <p className="text-[11px] text-muted-foreground">{t("in_lump")}</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{t("not_priced")}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </DrawerSection>

          <DrawerSection title={t("terms")}>
            <KeyValueRow label={t("lead_time")} value={r.leadDays != null ? t("lead_days", { days: r.leadDays }) : "—"} />
            <KeyValueRow label={t("payment")} value={<span className="flex flex-wrap items-center justify-end gap-1.5">{terms || "—"}{r.differsTerms && <StatusPill tone="warn">{t("differs")}</StatusPill>}</span>} />
            <KeyValueRow
              label={t("valid_until")}
              value={
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {r.validUntil ? date(r.validUntil) : "—"}
                  {r.validity === "expired" && <StatusPill tone="bad">{t("expired")}</StatusPill>}
                  {r.validity === "soon" && <StatusPill tone="warn">{t("soon")}</StatusPill>}
                  {priceConfirmed(r.offer) && <StatusPill tone="ok">{t("price_confirmed")}</StatusPill>}
                </span>
              }
            />
            <KeyValueRow label={t("official")} value={offer.offerPdfUrl ? <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-cta hover:underline">{t("attached")}</a> : t("not_attached")} />
            {note && <KeyValueRow label={t("note")} value={<span dir="auto">«{note}»</span>} />}
          </DrawerSection>

          <DrawerSection title={t("inquiries")} count={mine.length} defaultOpen={mine.length > 0}>
            {mine.length === 0 ? (
              <p className="py-1 text-xs text-muted-foreground">{t("no_inquiries")}</p>
            ) : (
              <ul className="space-y-2 py-1 text-sm">
                {mine.map((q) => {
                  const a = answerOf(q)
                  return (
                    <li key={q.id} className="space-y-0.5">
                      <p className="font-semibold" dir="auto">{inquiryKind(q) === "our_question" ? t("ours") : t("his")} · {publicQuestion(q)}</p>
                      <p className="text-xs text-muted-foreground" dir="auto">{a ? a.text : inquiryKind(q) === "our_question" ? t("awaiting_him") : t("awaiting_us")}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title={t("history")} count={history.length} defaultOpen>
            <ol className="space-y-1.5 py-1 text-sm" data-testid="offer-history">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                  <span dir="auto">
                    {th(h.kind, {
                      n: Number(h.params?.n ?? 0),
                      date: String(h.params?.date ?? ""),
                      from: h.params?.from != null ? Number(h.params.from).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "",
                      reason: h.kind === "excluded" ? th(`reason_${String(h.params?.reason || "other")}`) : "",
                    })}
                    {h.by ? ` · ${h.by}` : ""}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{date(h.at)}</span>
                </li>
              ))}
            </ol>
            {r.exclusion && <p className="pb-1 text-xs text-muted-foreground" dir="auto">{r.exclusion.text}</p>}
          </DrawerSection>
          {bafo.answered?.note ? <p className="text-xs text-muted-foreground" dir="auto">{bafo.answered.note}</p> : null}
        </div>

        {!r.awarded && (
          <footer className="flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3">
            {access.acts && open && ev.expired && !out && (
              <Button type="button" className="gap-2" onClick={() => actions.onReval(r)}>
                <CheckCircle2 size={14} aria-hidden="true" />
                {t("reval")}
              </Button>
            )}
            {canAward && (
              <Button type="button" variant="success" className="gap-2" onClick={() => actions.onAward({ offerId: r.id, lines: ev.partial ? ev.lines.map((l) => l.rfqProductIndex) : [], review: true })}>
                {ev.partial ? t("award_priced") : t("award_all")}
              </Button>
            )}
            {access.canShortlist && !r.excluded && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" aria-pressed={r.shortlisted} onClick={() => actions.onToggleShortlist(r)}>
                <Star size={14} className={cn(r.shortlisted && "fill-warning text-warning")} aria-hidden="true" />
                {r.shortlisted ? t("shortlisted") : t("shortlist")}
              </Button>
            )}
            {canAct && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => actions.onClarify(r)}>
                <MailQuestion size={14} aria-hidden="true" />
                {t("clarify")}
              </Button>
            )}
            {canAct && !bafo.asked && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => actions.onBafo(r)}>
                <TrendingDown size={14} aria-hidden="true" />
                {t("bafo")}
              </Button>
            )}
            {canAct && (
              <Button type="button" variant="outline" size="sm" onClick={() => actions.onSample(r)}>
                {t("sample")}
              </Button>
            )}
            {access.acts && open && r.excluded && (
              <Button type="button" variant="outline" size="sm" className="ms-auto gap-1.5" onClick={() => actions.onRestore(r)}>
                <RotateCcw size={14} aria-hidden="true" />
                {t("restore")}
              </Button>
            )}
            {canAct && (
              <Button type="button" variant="ghost" size="sm" className="ms-auto gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => actions.onExclude(r)}>
                <Ban size={14} aria-hidden="true" />
                {t("exclude")}
              </Button>
            )}
          </footer>
        )}
      </>
    )
  }
}
