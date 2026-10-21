"use client"

import { useTranslations } from "next-intl"
import { ChevronLeft } from "lucide-react"
import { Link } from "@/i18n/routing"
import type { GuideLinkDef, GuideSource } from "@/lib/procurement/guide"
import { cn } from "@/lib/utils"
import { ROLE_STYLE, RoleChip } from "./RoleChip"

/** «من أين تأتي الطلبات؟»: one card per place a request is born in the package being read. */
export function GuideSources({ sources, allowed }: { sources: GuideSource[]; allowed: (link: GuideLinkDef) => boolean }) {
  const t = useTranslations("Portal.ProcGuide")
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(14.5rem,1fr))]" data-testid="guide-sources">
      {sources.map((s) => (
        <div key={s.id} data-source={s.id} className={cn("flex flex-col items-start gap-1.5 rounded-2xl border border-t-[3px] bg-card p-3.5 shadow-sm", ROLE_STYLE[s.role].top)}>
          <RoleChip role={s.role} />
          <b className="text-[13.5px]">{t(`source.${s.id}.title`)}</b>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(`source.${s.id}.body`)}</p>
          {s.link && allowed(s.link) && (
            <Link href={s.link.href} className="mt-auto inline-flex items-center gap-1 text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t(s.link.labelKey)}
              <ChevronLeft size={12} className="rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}
