"use client"

// A supplier's file (PRD 3.0 §7.2, prototype dSup): what stops an order first
// (unverified, CR expired, no VAT number), then his own platform profile, the
// ratings — the platform's anonymous ones and ours per completed order with the
// receipt facts beside the stars — his record with us as bars computed from
// orders, receipts and invitations, our master record, his agreements (for
// those who see prices), his last orders and the record's log.

import { useSupplierVat } from "@/hooks/useSupplierVat"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, ShieldCheck, Star } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { displayCategory, displayCity } from "@/lib/constants"
import { displayAgreementNumber, displayPoNumber } from "@/lib/procurement/format"
import { poValue, todayOf, type SupplierScore } from "@/lib/procurement/po"
import { agreementsOfSupplier, type PriceAgreement } from "@/lib/procurement/prices"
import {
  SUPPLIER_FILE_ORDERS,
  barWidth,
  displayVat,
  effectiveCrExpiry,
  effectiveVat,
  profileVatMark,
  canVouchSuppliers,
  isOffPlatform,
  isUnverified,
  ordersOfSupplier,
  ourRatings,
  supplierDocs,
} from "@/lib/procurement/supplier-file"
import { SupplierWriteError, verifySupplier } from "@/lib/procurement/supplier-writes"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import { Money, PoStatusPill, useDateText } from "./PoBits"
import { SupplierRecordDialog } from "./SupplierRecordDialog"

export function Stars({ value, className }: { value: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span className={cn("inline-flex items-center gap-0.5 align-middle", className)} role="img" aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} className={i <= n ? "fill-warning text-warning" : "fill-muted text-muted"} aria-hidden="true" />
      ))}
    </span>
  )
}

function Bar({ label, value, good, text }: { label: string; value: number | null; good: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", value == null ? "" : good ? "bg-success" : "bg-warning")} style={{ width: `${barWidth(value)}%` }} />
      </div>
      <b className="w-14 shrink-0 text-end tabular-nums" dir="ltr">
        {text}
      </b>
    </div>
  )
}

export function SupplierFileDrawer({
  supplier,
  open,
  onOpenChange,
  score,
  invited,
  orders,
  agreements,
  actor,
  orgId,
  canManage,
  ownerHasTeam = false,
  now,
  onToggleFavorite,
  onRemove,
  onOpenAgreement,
}: {
  supplier: PlatformSupplier | null
  open: boolean
  onOpenChange: (open: boolean) => void
  score: SupplierScore | null
  invited: number
  orders: PurchaseOrder[]
  agreements: PriceAgreement[]
  actor: ProcActor
  orgId: string
  canManage: boolean
  /** The owner of a company with a procurement team reads: no verify, no edit. */
  ownerHasTeam?: boolean
  now: Date
  onToggleFavorite: (s: PlatformSupplier) => void
  onRemove: (s: PlatformSupplier) => void
  onOpenAgreement: (id: string) => void
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const fmt = useDateText()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const today = todayOf(now)
  const manager = canVouchSuppliers(actor, ownerHasTeam)

  const mine = useMemo(() => (supplier ? ordersOfSupplier(orders, supplier.orgId) : []), [orders, supplier])
  const rated = useMemo(() => (supplier ? ourRatings(orders, supplier.orgId) : []), [orders, supplier])
  const held = useMemo(() => (supplier ? agreementsOfSupplier(agreements, supplier.orgId) : []), [agreements, supplier])

  const supplierVat = useSupplierVat(supplier?.orgId, supplier?.profileVat, open)

  if (!supplier) return null
  const record = supplier.record
  const kind = record?.kind || "mat"
  const vat = effectiveVat(record, profileVatMark(supplier))
  const docs = supplierDocs(vat, effectiveCrExpiry(record, supplier.profileCrExpiry), today)
  const sep = isRtl ? "، " : ", "
  const hasRecord = Boolean(score && (score.orders > 0 || invited > 0))

  const verify = async () => {
    if (!firestore) return
    setVerifying(true)
    try {
      await verifySupplier(firestore, actor, orgId, supplier.orgId, profileVatMark(supplier), now, ownerHasTeam)
      toast({ title: t("toast.verified") })
    } catch (err) {
      const code = err instanceof SupplierWriteError ? err.code : "generic"
      toast({ title: t.has(`err.${code}`) ? t(`err.${code}`) : t("err.generic"), variant: "destructive" })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="space-y-1 border-b px-5 py-4 text-start">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-module/10 text-sm font-black text-module" aria-hidden="true">
                {supplier.name.slice(0, 2)}
              </span>
              <div className="min-w-0">
                <SheetTitle className="truncate text-lg" dir="auto">
                  {supplier.name}
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span>{t(`kind.${kind}`)}</span>
                  {supplier.city && <span>· {displayCity(supplier.city, locale)}</span>}
                  {supplier.platformVerified && (
                    <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">
                      <ShieldCheck size={11} aria-hidden="true" />
                      {t("file.platform_verified")}
                    </StatusPill>
                  )}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-3 px-5 py-4">
            {isUnverified(record) && (
              <Callout tone="warn">
                <p>{t("file.unverified", { name: record?.addedByName || "—" })}</p>
                {manager && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={verify} disabled={!vat || verifying}>
                      {verifying && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                      {t("file.verify")}
                    </Button>
                    {!vat && <span className="text-xs font-bold text-destructive">{t("file.verify_needs_vat")}</span>}
                  </div>
                )}
              </Callout>
            )}
            {isOffPlatform(supplier) && <Callout tone="info">{t("p2c.off_platform")}</Callout>}
            {docs.state === "cr_expired" && docs.crDays != null && <Callout tone="block">{t("file.cr_expired", { days: -docs.crDays })}</Callout>}
            {!vat && <Callout tone="warn">{t("file.no_vat")}</Callout>}

            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <Button size="sm" variant={supplier.isExplicitFavorite ? "outline" : "default"} onClick={() => onToggleFavorite(supplier)}>
                  {supplier.isExplicitFavorite ? t("file.fav_remove") : t("file.fav_add")}
                </Button>
              )}
              {supplier.isFavorite && <StatusPill tone="warn">★ {t("file.fav_pill")}</StatusPill>}
            </div>

            <DrawerSection title={t("file.profile_title")}>
              <KeyValueRow label={t("file.verified_since")} value={supplier.since ? fmt(supplier.since) : "—"} />
              <div className="border-b border-border/60 py-2">
                <p className="text-xs text-muted-foreground">{t("file.coverage")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[supplier.city, ...supplier.coverageCities].filter((c, i, a): c is string => Boolean(c) && a.indexOf(c) === i).map((c) => (
                    <StatusPill key={c} tone="mute">
                      {displayCity(c, locale)}
                    </StatusPill>
                  ))}
                  {!supplier.city && !supplier.coverageCities.length && <span className="text-sm text-muted-foreground">—</span>}
                </div>
              </div>
              <div className="border-b border-border/60 py-2">
                <p className="text-xs text-muted-foreground">{t("file.specialties")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {supplier.categories.length ? (
                    supplier.categories.map((c) => (
                      <StatusPill key={c} tone="mute">
                        {displayCategory(c, locale)}
                      </StatusPill>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <KeyValueRow
                label={t("file.certificates")}
                value={
                  supplier.certificates.length ? (
                    <span className="flex flex-col items-end">
                      {supplier.certificates.map((c, i) => (
                        <span key={c.id || i} dir="auto">
                          {c.name || "—"}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="font-normal text-muted-foreground">{t("file.no_certificates")}</span>
                  )
                }
              />
              <KeyValueRow label={t("file.works")} value={supplier.worksCount ? t("file.works_count", { count: supplier.worksCount }) : <span className="font-normal text-muted-foreground">{t("file.no_works")}</span>} />
              <p className={cn("border-b border-border/60 py-2 text-sm", supplier.bio ? "text-foreground" : "text-muted-foreground")} dir="auto">
                {supplier.bio || t("file.no_bio")}
              </p>
              {(supplier.phone || supplier.email) && <KeyValueRow label={t("file.contact")} ltr value={[supplier.phone, supplier.email].filter(Boolean).join(" · ")} />}
            </DrawerSection>

            {kind === "sub" && <Callout tone="info">{t("file.sub_note")}</Callout>}

            <DrawerSection title={t("file.ratings")}>
              <KeyValueRow
                label={t("file.platform_rating")}
                value={
                  supplier.rating ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Stars value={supplier.rating.avg} />
                      <b dir="ltr">{supplier.rating.avg.toFixed(1)}</b>
                      <span className="font-normal text-muted-foreground">({supplier.rating.n})</span>
                    </span>
                  ) : (
                    <span className="font-normal text-muted-foreground">{t("file.no_ratings")}</span>
                  )
                }
              />
              {supplier.reviews
                .filter((r) => r.comment)
                .slice(0, 5)
                .map((r) => (
                  <p key={r.id} className="border-b border-border/60 py-2 text-xs">
                    <Stars value={r.rating} /> <span className="text-foreground" dir="auto">{r.comment}</span> <span className="text-muted-foreground">— {t("file.a_contractor")}</span>
                  </p>
                ))}
              {rated.length ? (
                <>
                  <p className="-mx-4 bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">{t("file.ours_head")}</p>
                  {rated.map(({ po, rating }) => (
                    <div key={po.id} className="border-b border-border/60 py-2 last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/contractor/rfqs/orders?po=${po.id}`} className="rounded text-sm font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
                          {displayPoNumber(po.docNumber, locale)}
                        </Link>
                        <span className="text-[11px] text-muted-foreground">
                          {rating.byName} · {fmt(rating.at)} · {rating.publishAnonymously ? t("file.published") : t("file.internal")}
                        </span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
                        <span>{rating.onTime === false ? t("file.late_by", { days: rating.lateByDays }) : rating.onTime ? t("file.on_time") : null}</span>
                        <span>· {rating.inFull ? t("file.in_full") : t("file.short")}</span>
                        <span>
                          · {t("file.rejected")} <span dir="ltr">{rating.rejectPercent}%</span>
                        </span>
                        <span>· {t("file.conformity")}</span>
                        <Stars value={rating.conformity} />
                        <span>· {t("file.cooperation")}</span>
                        <Stars value={rating.cooperation} />
                      </p>
                      {rating.note && (
                        <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                          «{rating.note}»
                        </p>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{t("file.not_rated")}</p>
              )}
            </DrawerSection>

            <DrawerSection title={t("file.performance")}>
              {hasRecord && score ? (
                <>
                  <Bar label={t("file.bar_on_time")} value={score.onTimePercent} good={(score.onTimePercent ?? 0) >= 90} text={score.onTimePercent == null ? "—" : `${score.onTimePercent}%`} />
                  <Bar
                    label={t("file.bar_accepted")}
                    value={score.rejectPercent == null ? null : 100 - score.rejectPercent}
                    good={(score.rejectPercent ?? 100) < 2}
                    text={score.rejectPercent == null ? "—" : `${Math.round((100 - score.rejectPercent) * 10) / 10}%`}
                  />
                  <Bar label={t("file.bar_responds")} value={score.responsePercent} good={(score.responsePercent ?? 0) >= 80} text={score.responsePercent == null ? "—" : `${score.responsePercent}%`} />
                  <p className="py-2 text-xs text-muted-foreground">{t("file.performance_note", { orders: score.orders, invitations: invited })}</p>
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{t("file.no_performance")}</p>
              )}
            </DrawerSection>

            <DrawerSection title={t("file.master")}>
              <KeyValueRow label={t("file.supplies")} value={supplier.categories.map((c) => displayCategory(c, locale)).join(sep) || "—"} />
              <KeyValueRow label={t("file.vat")} ltr value={displayVat(record, supplierVat) || (vat ? t("file.vat_on_file") : "—")} />
              <KeyValueRow label={t("file.cr_expires")} value={docs.crExpiry ? fmt(docs.crExpiry) : t("file.not_recorded")} />
              <KeyValueRow
                label={
                  <span>
                    {t("file.terms")} <span className="text-[10.5px]">{t("file.read_by_finance")}</span>
                  </span>
                }
                value={record?.paymentTermsDays ? t("file.terms_days", { days: record.paymentTermsDays }) : record ? t("file.cash") : t("file.not_recorded")}
              />
              {record?.leadTimeDays ? <KeyValueRow label={t("file.lead")} value={t("file.days", { count: record.leadTimeDays })} /> : null}
              {manager && (
                <div className="pt-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    {t("file.edit")}
                  </Button>
                </div>
              )}
            </DrawerSection>

            {actor.seesPrices && held.length > 0 && (
              <DrawerSection title={t("file.agreements")} count={held.length}>
                {held.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenAgreement(a.id)}
                    className="flex w-full items-baseline justify-between gap-3 border-b border-border/60 py-2 text-start text-sm last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <b dir="ltr">{displayAgreementNumber(a.docNumber, locale)}</b> · {(a.lines || []).map((l) => l.name).join(sep)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmt(a.until)}</span>
                  </button>
                ))}
              </DrawerSection>
            )}

            <DrawerSection title={t("file.orders")} count={mine.length}>
              {mine.length ? (
                mine.slice(0, SUPPLIER_FILE_ORDERS).map((po) => (
                  <Link
                    key={po.id}
                    href={`/contractor/rfqs/orders?po=${po.id}`}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 truncate">
                      <b dir="ltr">{displayPoNumber(po.docNumber, locale)}</b> · {po.lines.map((l) => l.name).join(sep)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Money value={poValue(po)} masked={!actor.seesPrices} className="text-xs font-bold" />
                      <PoStatusPill po={po} now={now} />
                    </span>
                  </Link>
                ))
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{t("file.no_orders")}</p>
              )}
            </DrawerSection>

            <DrawerSection title={t("file.log")} count={record?.log?.length || 0} defaultOpen={false}>
              {record?.log?.length ? (
                [...record.log].reverse().map((l, i) => (
                  <p key={i} className="border-b border-border/60 py-2 text-sm last:border-b-0">
                    {t(`log.${l.action}`)} <span className="text-xs text-muted-foreground">— {l.byName} · {fmt(l.at)}</span>
                  </p>
                ))
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{t("file.no_log")}</p>
              )}
            </DrawerSection>

            {canManage && supplier.linkId && (
              <div className="pt-1">
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemove(supplier)}>
                  {t("file.remove")}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <SupplierRecordDialog open={editing} onOpenChange={setEditing} supplier={supplier} actor={actor} orgId={orgId} ownerHasTeam={ownerHasTeam} />
    </>
  )
}

