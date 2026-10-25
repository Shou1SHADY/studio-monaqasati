"use client"

import { useTranslations } from "next-intl"
import { Layers } from "lucide-react"
import { Link } from "@/i18n/routing"
import { guideHref } from "@/lib/procurement/guide"
import { cn } from "@/lib/utils"

/** The door to «كيف تعمل المشتريات؟»: «incoming» sits in the Incoming page's head, «mine» under «طلباتي». */
export function GuideLink({ variant = "incoming", className }: { variant?: "incoming" | "mine"; className?: string }) {
  const t = useTranslations("Portal.ProcGuide.link")
  return (
    <Link
      href={guideHref(variant)}
      className={cn("inline-flex items-center gap-1.5 text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <Layers size={13} aria-hidden="true" />
      {t(variant)}
    </Link>
  )
}
