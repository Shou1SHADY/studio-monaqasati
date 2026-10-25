"use client"

// The head of the receiver's page (RC-06, prototype `rcvlink`): a strip with the Mdmak mark, «استلام شحنة» and the buying company,
// with the language switch at its end; then the order and notice numbers, «شحنة من {المورد}», and one meta row — where the goods go
// (the place and its address or map), the delivery day, and the buyer's note. The live page (`/receive/[token]`) and «كما يراه
// المستلم» render the SAME head, so the preview is the page. All words are `ReceiveLink.*`.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, ExternalLink, MapPin, PackageCheck, StickyNote } from "lucide-react"
import { displayNoticeNumber, displayPoNumber, fmtDayLong } from "@/lib/procurement/format"

export interface ReceivePageHeadProps {
  companyName?: string | null
  supplierName?: string | null
  poNumber?: string | null
  noticeNumber?: string | null
  rfqTitle?: string | null
  placeName?: string | null
  address?: string | null
  mapUrl?: string | null
  deliveryDate?: string | null
  note?: string | null
  /** The language switch (a link on the live page; inert in the preview). */
  localeSwitch?: ReactNode
}

export function ReceiveStrip({ companyName, localeSwitch }: Pick<ReceivePageHeadProps, "companyName" | "localeSwitch">) {
  const t = useTranslations("ReceiveLink")
  return (
    <div className="flex items-center gap-3 border-b pb-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-base font-black text-primary-foreground" aria-hidden="true">
        {t("brand_mark")}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <b className="text-sm text-foreground">{t("brand")}</b>
        <small className="text-[10px] text-muted-foreground" dir="ltr">
          MDMAK TECH
        </small>
      </span>
      <span className="h-8 w-px shrink-0 bg-border" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <b className="flex items-center gap-1 text-sm text-foreground">
          <PackageCheck size={14} className="text-module" aria-hidden="true" />
          {t("eyebrow")}
        </b>
        {companyName && (
          <small className="truncate text-[11px] text-muted-foreground" dir="auto">
            {companyName}
          </small>
        )}
      </span>
      {localeSwitch}
    </div>
  )
}

export function ReceivePageHead(p: ReceivePageHeadProps) {
  const t = useTranslations("ReceiveLink")
  const locale = useLocale()
  const day = p.deliveryDate ? fmtDayLong(p.deliveryDate.slice(0, 10), locale) : null
  return (
    <header className="space-y-3">
      <ReceiveStrip companyName={p.companyName} localeSwitch={p.localeSwitch} />
      <div className="space-y-1">
        {(p.poNumber || p.noticeNumber) && (
          <p className="text-xs text-muted-foreground">
            {p.poNumber && (
              <>
                {t("order_label")} <bdi dir="ltr">{displayPoNumber(p.poNumber, locale)}</bdi>
              </>
            )}
            {p.poNumber && p.noticeNumber ? " · " : ""}
            {p.noticeNumber && <bdi dir="ltr">{displayNoticeNumber(p.noticeNumber, locale)}</bdi>}
          </p>
        )}
        <h1 className="text-xl font-black leading-relaxed text-foreground" dir="auto">
          {p.supplierName ? t("from_supplier", { name: p.supplierName }) : t("supplier_unknown")}
        </h1>
        {p.rfqTitle && (
          <p className="text-sm text-muted-foreground" dir="auto">
            {p.rfqTitle}
          </p>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground" aria-label={t("meta_label")}>
          {(p.placeName || p.address) && (
            <li className="flex items-center gap-1">
              <MapPin size={13} className="shrink-0 text-module" aria-hidden="true" />
              <span dir="auto">{[p.placeName, p.address].filter(Boolean).join(" · ")}</span>
              {p.mapUrl && (
                <a href={p.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("map")}
                  <ExternalLink size={10} aria-hidden="true" />
                </a>
              )}
            </li>
          )}
          {day && (
            <li className="flex items-center gap-1">
              <CalendarDays size={13} className="shrink-0 text-module" aria-hidden="true" />
              {t("delivery_on")} <b className="text-foreground">{day}</b>
            </li>
          )}
          {p.note && (
            <li className="flex items-center gap-1">
              <StickyNote size={13} className="shrink-0 text-module" aria-hidden="true" />
              <span dir="auto">{p.note}</span>
            </li>
          )}
        </ul>
      </div>
    </header>
  )
}
