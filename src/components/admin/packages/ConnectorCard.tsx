"use client"

import { useTranslations } from "next-intl"
import { Callout } from "@/components/module-ui/Callout"
import { Switch } from "@/components/ui/switch"
import { connectorTexts, type Connector } from "@/lib/procurement/package"
import { cn } from "@/lib/utils"
import { UnitIcon } from "./PackageIcons"

/** One connector: what it adds when open, what the base does without it when closed, and the warnings the answer to its question raises. */
export function ConnectorCard({ conn, on, answer, onToggle, disabled }: { conn: Connector; on: boolean; answer: 0 | 1 | null | undefined; onToggle: (on: boolean) => void; disabled?: boolean }) {
  const t = useTranslations("Portal.AdminPackages.detail.card")
  const tp = useTranslations("Portal.ProcPackage")
  const texts = connectorTexts(conn, tp)
  const suggested = answer === 1
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", on ? "border-module/30 bg-card" : "bg-muted/30")} data-conn={conn} data-on={on ? "true" : "false"}>
      <div className="flex items-center gap-3">
        <UnitIcon unit={conn} on={on} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <b className="block text-sm">{texts.name}</b>
          {suggested && <span className="inline-block rounded-full bg-cta/10 px-2 py-0.5 text-[11px] font-semibold text-cta">{t("suggested")}</span>}
        </div>
        <Switch checked={on} onCheckedChange={onToggle} aria-label={texts.name} disabled={disabled} />
      </div>
      <div className="text-xs text-muted-foreground">
        <small className="block font-bold">{t(on ? "opens" : "closed")}</small>
        <ul className="ms-4 mt-1 list-disc space-y-0.5">
          {(on ? texts.adds : texts.without).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {suggested && !on && <Callout tone="warn">{t("warn_closed")}</Callout>}
      {answer === 0 && on && <Callout tone="info">{t("warn_open")}</Callout>}
    </div>
  )
}
