"use client"

// A platform supplier's profile as he wrote it (prototype dDir), and the one
// decision it serves: add him to ours — he lands unverified, and his VAT number
// and payment terms stay a condition before the first order — or, when he is
// already ours, open our file on him.

import { useSupplierVat } from "@/hooks/useSupplierVat"
import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { displayCategory, displayCity } from "@/lib/constants"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { keyLabel, specialtyKeys } from "@/lib/materials/subs"
import { todayOf } from "@/lib/procurement/po"
import { effectiveCrExpiry, effectiveVat, profileVatMark, supplierDocs } from "@/lib/procurement/supplier-file"
import { SupplierWriteError, addFromDirectory } from "@/lib/procurement/supplier-writes"
import type { ProcActor } from "@/lib/procurement/types"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import { supplierInitials } from "@/lib/procurement/supplier-list"
import type { SupplierCard } from "@/lib/procurement/supplier-stats"
import { Stars } from "./SupplierFileDrawer"
import { SupplierOfficialSection, SupplierOptionalSlots, SupplierStatePills } from "./SupplierProfileSections"

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-bold text-foreground">{children}</div>
    </div>
  )
}

export function DirectoryDrawer({
  supplier,
  open,
  onOpenChange,
  actor,
  orgId,
  canManage,
  ownerHasTeam = false,
  onOpenOurs,
  card,
}: {
  /** What the platform knows of him across all buyers — operations completed, on-time, the rating computed from his orders. */
  card?: SupplierCard | null
  supplier: PlatformSupplier | null
  open: boolean
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgId: string
  canManage: boolean
  ownerHasTeam?: boolean
  onOpenOurs: (orgId: string) => void
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const supplierVat = useSupplierVat(supplier?.orgId, supplier?.profileVat, open)
  const { index } = useMaterialTree()

  if (!supplier) return null
  // SP-02: the same profile our file shows — the buyer is asked to check it before adding him.
  const today = todayOf(new Date())
  const vat = effectiveVat(null, profileVatMark(supplier))
  const docs = supplierDocs(vat, effectiveCrExpiry(null, supplier.profileCrExpiry), today)
  const specialties = specialtyKeys(index, supplier.subIds, supplier.categories)

  const add = async () => {
    if (!firestore) return
    setAdding(true)
    try {
      await addFromDirectory(firestore, actor, orgId, { orgId: supplier.orgId, name: supplier.name, categories: supplier.categories, vat: supplier.profileVat }, new Date(), ownerHasTeam)
      toast({ title: t("toast.added") })
    } catch (err) {
      const code = err instanceof SupplierWriteError ? err.code : "generic"
      toast({ title: t.has(`err.${code}`) ? t(`err.${code}`) : t("err.generic"), variant: "destructive" })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-5 py-4 text-start">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-module/10 text-sm font-black text-module" aria-hidden="true">
              {supplierInitials(supplier.name)}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg" dir="auto">
                {supplier.name}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                <span>{t("dir.from_directory")}</span>
                {supplier.city && <span>· {displayCity(supplier.city, locale)}</span>}
                {supplier.platformVerified && <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">{t("dir.platform_verified")}</StatusPill>}
              </SheetDescription>
              <div className="pt-1.5">
                <SupplierStatePills verified={supplier.platformVerified} onPlatform since={supplier.since} ours={supplier.isMine} />
              </div>
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-3 px-5 py-4">
          {supplier.isMine ? (
            <>
              <Callout tone="info">{t("dir.already_ours")}</Callout>
              <Button variant="outline" onClick={() => onOpenOurs(supplier.orgId)}>
                {t("dir.open_ours")}
              </Button>
            </>
          ) : (
            <>
              <Callout tone="info">{t("dir.check_first")}</Callout>
              {canManage && (
                <Button onClick={add} disabled={adding} className="gap-1.5">
                  {adding ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                  {t("dir.add")}
                </Button>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("file2.stat_ops")}>{card ? <span dir="ltr">{card.completedOps.toLocaleString("en-US")}</span> : "—"}</Stat>
            <Stat label={t("file2.stat_on_time")}>{card?.onTimePercent != null ? <span dir="ltr">{card.onTimePercent}%</span> : "—"}</Stat>
            <Stat label={t("file2.stat_rating")}>
              {card?.rating != null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Stars value={card.rating} />
                  <span dir="ltr">{card.rating.toFixed(1)}</span>
                </span>
              ) : supplier.rating ? (
                <span className="inline-flex items-center gap-1.5">
                  <Stars value={supplier.rating.avg} />
                  <span dir="ltr">{supplier.rating.avg.toFixed(1)}</span>
                  <small className="font-normal text-muted-foreground">({supplier.rating.n})</small>
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">{t("dir.no_ratings_yet")}</span>
              )}
            </Stat>
            <Stat label={t("file.vat")}>
              <span dir="ltr">{supplierVat || (supplier.profileHasVat ? t("file.vat_on_file") : "—")}</span>
            </Stat>
          </div>

          <DrawerSection title={t("col.supplies")}>
            <div className="flex flex-wrap gap-1.5 border-b border-border/60 py-2">
              {specialties.length ? (
                specialties.map((c) => (
                  <StatusPill key={c} tone="mute">
                    {keyLabel(index, c, locale, displayCategory)}
                  </StatusPill>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <KeyValueRow label={t("col.city")} value={supplier.city ? displayCity(supplier.city, locale) : "—"} />
            <KeyValueRow label={t("dir.on_platform_since")} value={supplier.since ? supplier.since.slice(0, 4) : "—"} />
          </DrawerSection>

          {supplier.bio && (
            <p className="rounded-xl border bg-muted/30 px-3 py-2.5 text-sm" dir="auto">
              {supplier.bio}
            </p>
          )}
          <SupplierOfficialSection
            supplier={supplier}
            facts={{ crExpiry: docs.crExpiry, crDays: docs.crDays, crExpired: docs.state === "cr_expired", vatText: supplierVat || (supplier.profileHasVat ? t("file.vat_on_file") : null) }}
          />
          <SupplierOptionalSlots supplier={supplier} today={today} />

          <DrawerSection title={t("dir.before_adding")}>
            <KeyValueRow label={t("dir.dealt_with")} value={supplier.isMine ? t("dir.dealt_yes") : t("dir.dealt_no")} />
            <KeyValueRow label={t("dir.from_platform")} value={t("dir.from_platform_value")} />
            <KeyValueRow label={t("dir.remains_on_us")} value={t("dir.remains_on_us_value")} />
            <p className="py-2 text-xs text-muted-foreground">{t("dir.public_rfq_note")}</p>
          </DrawerSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}
