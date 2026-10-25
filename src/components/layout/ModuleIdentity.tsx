"use client"

// The module's identity in the top bar (Procurement 2.0 prototype top bar, gap FR-03): after «المحور», the module's tile in
// its own colour, its name and its line («الطلبات الواردة · العروض · أوامر الشراء») — so the module is still named when the
// sidebar is folded or on a phone. Procurement's frame only: every other module's top bar is as it was.

import { useTranslations } from "next-intl"
import { resolveActiveContractorComponent } from "@/lib/portal-components"

export function ModuleIdentity({ pathname }: { pathname: string }) {
  const t = useTranslations("Portal.Sidebar")
  if (!pathname.startsWith("/contractor")) return null
  const component = resolveActiveContractorComponent(pathname)
  if (component.id !== "procurement") return null
  const Icon = component.icon
  return (
    <div className="hidden min-w-0 items-center gap-2 sm:flex" data-testid="module-identity">
      <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <b className="block truncate text-sm font-black text-foreground">{t(component.labelKey)}</b>
        <span className="hidden truncate text-[11px] text-muted-foreground md:block">{t("proc_sub")}</span>
      </span>
    </div>
  )
}
