"use client"

// The parts of a supplier's file that are HIS platform profile (prototype `DRAW.sup`, SP-01/SP-02/SP-06), shared by our file
// (`SupplierFileDrawer`) and the directory's drawer (`DirectoryDrawer`) — the directory asks the buyer to «check his profile» before
// adding him, so it shows the same profile:
//   · `SupplierStatePills` — the head's three facts at once: verified by us or not · on the platform since … / off the platform ·
//     one of ours;
//   · `SupplierOfficialSection` — CR and its expiry («قريباً» under 60 days), VAT or «لم يُرفع — يُطلب قبل الترسية», the national
//     address, the contact (name · mobile · e-mail), coverage, on the platform since, and how fast he answers when we know it;
//   · `SupplierOptionalSlots` — the open slots he fills from his account or leaves: the profile file, previous work (a grid, the first
//     photo as the thumbnail, opening its photos), certificates (valid until — amber under 60 days — and «اعرض» when he uploaded it)
//     and supporting files. Every file opens as he uploaded it, in a new tab.
// All words are `Portal.ProcSuppliers.*`.

import { useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { Camera, Eye, FileText, ShieldCheck } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { buttonVariants } from "@/components/ui/button"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { displayCity } from "@/lib/constants"
import { daysBetween } from "@/lib/procurement/po"
import type { PlatformSupplier, SupplierWork } from "@/hooks/useSupplierDirectory"
import { useDateText } from "./PoBits"

/** Days until a `YYYY-MM-DD` date (negative once past); null when there is no date. */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null
  return daysBetween(today, date.slice(0, 10))
}

/** A certificate whose validity ends within 60 days — the prototype's amber. */
export const expiresSoon = (days: number | null): boolean => days != null && days <= 60

export function SupplierStatePills({ verified, onPlatform, since, ours }: { verified: boolean; onPlatform: boolean; since: string | null; ours: boolean }) {
  const tf = useTranslations("Portal.ProcSuppliers.file2")
  const fmt = useDateText()
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={verified ? "ok" : "warn"} className="px-2 py-0 text-[10.5px]">
        {verified && <ShieldCheck size={11} aria-hidden="true" />}
        {verified ? tf("pill_verified") : tf("pill_unverified")}
      </StatusPill>
      <StatusPill tone={onPlatform ? "info" : "mute"} className="px-2 py-0 text-[10.5px]">
        {onPlatform ? (since ? tf("pill_on_platform_since", { date: fmt(since) }) : tf("pill_on_platform")) : tf("pill_off_platform")}
      </StatusPill>
      {ours && (
        <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">
          {tf("pill_ours")}
        </StatusPill>
      )}
    </span>
  )
}

export interface OfficialFacts {
  crExpiry: string | null
  crDays: number | null
  crExpired: boolean
  /** The VAT number as the reader may see it, a "on file" mark, or null when none was uploaded. */
  vatText: React.ReactNode | null
  responsePercent?: number | null
}

export function SupplierOfficialSection({ supplier, facts }: { supplier: PlatformSupplier; facts: OfficialFacts }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const fmt = useDateText()
  const sep = locale === "ar" ? "، " : ", "
  const crSoon = facts.crDays != null && facts.crDays >= 0 && facts.crDays <= 60
  return (
    <DrawerSection title={t("file2.official")}>
      <KeyValueRow
        label={t("file2.cr")}
        value={
          <span className="flex flex-col items-end">
            <span dir="ltr">{supplier.crNumber || "—"}</span>
            <span className={cn("text-xs font-normal", crSoon || facts.crExpired ? "text-warning" : "text-muted-foreground")}>
              {facts.crExpiry ? `${t("file2.cr_expires", { date: fmt(facts.crExpiry) })}${crSoon ? ` · ${t("file2.soon")}` : ""}` : t("file.not_recorded")}
            </span>
          </span>
        }
      />
      <KeyValueRow label={t("file.vat")} ltr value={facts.vatText || <span className="font-normal text-warning">{t("file2.vat_missing")}</span>} />
      <KeyValueRow label={t("file2.address")} value={supplier.address ? <span dir="auto">{supplier.address}</span> : <span className="font-normal text-muted-foreground">—</span>} />
      <KeyValueRow
        label={t("file2.contact")}
        value={
          <span className="flex flex-col items-end">
            <span dir="auto">{supplier.contactName || "—"}</span>
            {supplier.phone && <span className="text-xs font-normal" dir="ltr">{supplier.phone}</span>}
            {supplier.email && <span className="text-xs font-normal" dir="ltr">{supplier.email}</span>}
          </span>
        }
      />
      <KeyValueRow label={t("file2.coverage")} value={[supplier.city, ...supplier.coverageCities].filter((c, i, a): c is string => Boolean(c) && a.indexOf(c) === i).map((c) => displayCity(c, locale)).join(sep) || "—"} />
      <KeyValueRow label={t("file.verified_since")} value={supplier.since ? fmt(supplier.since) : "—"} />
      {facts.responsePercent != null && <KeyValueRow label={t("file2.response")} value={<span dir="ltr">{facts.responsePercent}%</span>} />}
    </DrawerSection>
  )
}

function Optional({ title, empty, children, hasContent }: { title: string; empty: string; children?: React.ReactNode; hasContent: boolean }) {
  const t2 = useTranslations("Portal.ProcSuppliers.file2")
  return (
    <DrawerSection title={`${title} · ${t2("optional")}`}>
      {hasContent ? children : <p className="py-2 text-sm text-muted-foreground">{empty}</p>}
    </DrawerSection>
  )
}

/** Opens a file as the supplier uploaded it — a new tab, never through our page. */
function ViewLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={cn(buttonVariants({ variant: "outline", size: "icon" }), "h-9 w-9 shrink-0")}>
      <Eye size={14} aria-hidden="true" />
    </a>
  )
}

export function SupplierOptionalSlots({ supplier, today }: { supplier: PlatformSupplier; today: string }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const fmt = useDateText()
  const [work, setWork] = useState<SupplierWork | null>(null)
  const works = supplier.works || []
  const files = supplier.files || []
  const worksCount = Math.max(works.length, supplier.worksCount)
  return (
    <>
      <Optional title={t("file2.profile")} empty={t("file2.no_profile")} hasContent={Boolean(supplier.bio || supplier.profileFileUrl)}>
        {supplier.profileFileUrl && (
          <div className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-destructive/10 text-[10px] font-black text-destructive" aria-hidden="true">
              PDF
            </span>
            <b className="min-w-0 flex-1 truncate" dir="auto">
              {t("file2.profile_file", { name: supplier.name })}
            </b>
            <ViewLink href={supplier.profileFileUrl} label={t("file2.view")} />
          </div>
        )}
        {supplier.bio && (
          <p className="py-2 text-sm" dir="auto">
            {supplier.bio}
          </p>
        )}
      </Optional>
      <Optional title={t("file2.works")} empty={t("file2.no_works")} hasContent={worksCount > 0}>
        {works.length ? (
          <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3">
            {works.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWork(w)}
                disabled={!w.images.length}
                className="group overflow-hidden rounded-lg border bg-card text-start hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <span className="relative grid aspect-[4/3] place-items-center bg-muted text-muted-foreground">
                  {w.images[0] ? <Image src={w.images[0]} alt="" fill sizes="160px" className="object-cover" unoptimized /> : <Camera size={18} aria-hidden="true" />}
                  <span className="absolute bottom-1 end-1 rounded bg-background/90 px-1.5 text-[10px] font-semibold text-foreground">{t("file2.photos", { count: w.images.length })}</span>
                </span>
                <span className="block truncate px-2 py-1.5 text-xs font-semibold" dir="auto">
                  {w.title || "—"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-2 text-sm">{t("file.works_count", { count: worksCount })}</p>
        )}
      </Optional>
      <Optional title={t("file2.certs")} empty={t("file2.no_certs")} hasContent={supplier.certificates.length > 0 || files.length > 0}>
        {supplier.certificates.map((c, i) => {
          const days = daysUntil(c.expiryDate, today)
          return (
            <div key={c.id || i} className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-success/10 text-success" aria-hidden="true">
                <ShieldCheck size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <b className="block truncate" dir="auto">
                  {c.name || "—"}
                </b>
                {c.expiryDate && (
                  <span className={cn("text-xs", expiresSoon(days) ? "font-semibold text-warning" : "text-muted-foreground")}>
                    {days != null && days < 0 ? t("file2.expired_on", { date: fmt(c.expiryDate) }) : t("file2.valid_until", { date: fmt(c.expiryDate) })}
                  </span>
                )}
              </div>
              {c.documentUrl && /^https:\/\//i.test(c.documentUrl) && <ViewLink href={c.documentUrl} label={t("file2.view")} />}
            </div>
          )
        })}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
              <FileText size={14} />
            </span>
            <b className="min-w-0 flex-1 truncate" dir="auto">
              {f.name}
            </b>
            <ViewLink href={f.url} label={t("file2.view")} />
          </div>
        ))}
      </Optional>
      <p className="text-xs text-muted-foreground">{t("file2.slots_note")}</p>

      <Dialog open={Boolean(work)} onOpenChange={(o) => !o && setWork(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader className="text-start">
            <DialogTitle dir="auto">{work?.title || t("file2.works")}</DialogTitle>
            <DialogDescription dir="auto">{work?.description || t("file2.photos", { count: work?.images.length || 0 })}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(work?.images || []).map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Image src={src} alt={t("file2.photo_n", { n: i + 1, title: work?.title || "" })} fill sizes="(max-width: 640px) 100vw, 360px" className="object-cover" unoptimized />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
