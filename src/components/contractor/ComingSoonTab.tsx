"use client"

import { useTranslations } from "next-intl"
import { Sparkles } from "lucide-react"
import { sectionLabelKey, sectionDescKey, type SectionId } from "@/lib/project-sections"

interface ComingSoonTabProps {
  sectionId: SectionId
  tShared: ReturnType<typeof useTranslations<"Portal.Shared">>
}

/** Placeholder content for a project section that's enabled but not built yet. */
export function ComingSoonTab({ sectionId, tShared }: ComingSoonTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center border border-dashed rounded-2xl bg-slate-50/50">
      <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center">
        <Sparkles size={24} className="text-amber-500" />
      </div>
      <div>
        <p className="font-bold text-foreground">{tShared(sectionLabelKey(sectionId))}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{tShared(sectionDescKey(sectionId))}</p>
      </div>
      <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full mt-1">
        {tShared("sec_ghost_badge")}
      </span>
      <p className="text-xs text-muted-foreground max-w-xs">{tShared("sec_ghost_desc")}</p>
    </div>
  )
}
