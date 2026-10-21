"use client"

// «الباقة: الكاملة» in the top bar of the Procurement pages (Procurement 2.0, PKG-05): which package the company has,
// at a glance, on the pages that change with it. Read-only; the subscription is the admin's.

import { useTranslations } from "next-intl"
import { Package } from "lucide-react"
import { useModules } from "@/hooks/useCompanyModules"
import { packageLabel, packageOf } from "@/lib/procurement/package"

const PROCUREMENT_PAGES = [/^\/contractor\/rfqs(\/|$)/, /^\/contractor\/goods-received(\/|$)/, /^\/contractor\/suppliers(\/|$)/]

/** Whether a (locale-less) address is one of the Procurement pages. */
export const showsPackageChip = (pathname: string | null | undefined): boolean => !!pathname && PROCUREMENT_PAGES.some((re) => re.test(pathname))

export function PackageChip({ pathname }: { pathname: string | null | undefined }) {
  const tp = useTranslations("Portal.ProcPackage")
  const { off, loading } = useModules()
  if (loading || !showsPackageChip(pathname)) return null
  const label = tp("chip", { label: packageLabel(packageOf(Array.from(off)), tp) })
  return (
    <span data-testid="package-chip" title={label} className="hidden max-w-[16rem] items-center gap-1.5 truncate rounded-full bg-module/10 px-2.5 py-1 text-xs font-bold text-module md:inline-flex">
      <Package size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
}
