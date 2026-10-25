"use client"

// «الباقة: الكاملة» in the top bar of the Procurement pages (Procurement 2.0, PKG-05): which package the company has,
// at a glance, on the pages that change with it. Read-only; the subscription is the admin's. Beside the words, the five
// units — the base pair, a divider, the three connectors greyed when closed (prototype `subChips`, gap FR-04); for whoever
// may read the subscription (the owner, the approver) the chip opens Settings › Subscription.

import { useTranslations } from "next-intl"
import { Package } from "lucide-react"
import { Link } from "@/i18n/routing"
import { UnitIcon } from "@/components/admin/packages/PackageIcons"
import { useModules } from "@/hooks/useCompanyModules"
import { useProcActor } from "@/hooks/useProcActor"
import { CONNECTORS, packageLabel, packageOf } from "@/lib/procurement/package"
import { cn } from "@/lib/utils"

const PROCUREMENT_PAGES = [/^\/contractor\/rfqs(\/|$)/, /^\/contractor\/goods-received(\/|$)/, /^\/contractor\/suppliers(\/|$)/]

/** Whether a (locale-less) address is one of the Procurement pages. */
export const showsPackageChip = (pathname: string | null | undefined): boolean => !!pathname && PROCUREMENT_PAGES.some((re) => re.test(pathname))

/** Settings › Subscription — the segment the chip opens. */
export const SUBSCRIPTION_HREF = "/contractor/rfqs/settings?seg=sub"

export function PackageChip({ pathname }: { pathname: string | null | undefined }) {
  if (!showsPackageChip(pathname)) return null
  return <PackageChipBody />
}

function PackageChipBody() {
  const tp = useTranslations("Portal.ProcPackage")
  const { off, loading } = useModules()
  const { actor, isLoading } = useProcActor()
  if (loading) return null
  const pkg = packageOf(Array.from(off))
  const label = tp("chip", { label: packageLabel(pkg, tp) })
  const units = (
    <span className="hidden items-center gap-0.5 lg:inline-flex" role="img" aria-label={[tp("base.core.short"), tp("base.inv.short"), ...CONNECTORS.filter((c) => pkg[c]).map((c) => tp(`conn.${c}.short`))].join(" + ")}>
      <UnitIcon unit="core" className="h-5 w-5 rounded-md" />
      <UnitIcon unit="inv" className="h-5 w-5 rounded-md" />
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      {CONNECTORS.map((c) => (
        <UnitIcon key={c} unit={c} on={pkg[c]} className="h-5 w-5 rounded-md" />
      ))}
    </span>
  )
  const body = (
    <>
      <Package size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {units}
    </>
  )
  const look = "hidden max-w-[24rem] items-center gap-1.5 truncate rounded-full bg-module/10 px-2.5 py-1 text-xs font-bold text-module md:inline-flex"
  // The subscription is read by the roles the Settings matrix names: the owner and whoever approves orders.
  if (!isLoading && (actor.isOwner || actor.canApprove))
    return (
      <Link href={SUBSCRIPTION_HREF} data-testid="package-chip" title={label} className={cn(look, "hover:bg-module/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
        {body}
      </Link>
    )
  return (
    <span data-testid="package-chip" title={label} className={look}>
      {body}
    </span>
  )
}
