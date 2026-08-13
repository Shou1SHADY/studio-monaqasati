"use client"

// Grouped checkbox grid for toggling a project's "sections" (أقسام المشروع).
// Shared between the new-project wizard's Sections step and the project
// detail page's "manage sections" dialog.

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Lock, Check } from "lucide-react"
import { SECTION_IDS, SECTION_GROUPS, SECTION_REGISTRY, sectionLabelKey, sectionDescKey, type SectionId } from "@/lib/project-sections"

interface SectionToggleGridProps {
  enabledSections: Set<SectionId>
  onToggle: (id: SectionId) => void
  requiredHintLabel: string
  tShared: ReturnType<typeof useTranslations<"Portal.Shared">>
}

export function SectionToggleGrid({ enabledSections, onToggle, requiredHintLabel, tShared }: SectionToggleGridProps) {
  return (
    <div className="space-y-6">
      {SECTION_GROUPS.map((group) => (
        <div key={group} className="space-y-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            {tShared(`sec_group_${group}`)}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SECTION_IDS.filter((id) => SECTION_REGISTRY[id].group === group).map((id) => {
              const def = SECTION_REGISTRY[id]
              const enabled = enabledSections.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  disabled={def.required}
                  onClick={() => onToggle(id)}
                  className={cn(
                    "text-start p-4 rounded-2xl border transition-all",
                    enabled ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-white hover:border-slate-300",
                    def.required ? "cursor-not-allowed opacity-90" : "cursor-pointer"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-slate-800">{tShared(sectionLabelKey(id))}</span>
                    {def.required ? (
                      <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        <Lock size={9} />
                        {requiredHintLabel}
                      </span>
                    ) : (
                      <span className={cn(
                        "shrink-0 h-5 w-5 rounded-full border flex items-center justify-center transition-colors",
                        enabled ? "bg-primary border-primary text-white" : "border-slate-300 text-transparent"
                      )}>
                        <Check size={12} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {tShared(sectionDescKey(id))}
                  </p>
                  {def.status === "ghost" && (
                    <span className="inline-block mt-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      {tShared("sec_ghost_badge")}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
