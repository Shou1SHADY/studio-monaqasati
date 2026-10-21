"use client"

import { useTranslations } from "next-intl"
import { Eye } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import type { GuideLinkDef, GuideStation } from "@/lib/procurement/guide"
import { cn } from "@/lib/utils"
import { ROLE_STYLE, RoleChip } from "./RoleChip"

/** The eight stations as a mini path and as cards: who owns each, what happens, what the requester sees, and a plain link to the real page. */
export function GuideStations({ stations, limit, allowed }: { stations: GuideStation[]; limit: string; allowed: (link: GuideLinkDef) => boolean }) {
  const t = useTranslations("Portal.ProcGuide")
  return (
    <>
      <ol className="flex flex-wrap items-center gap-1.5 rounded-2xl border bg-card p-3 shadow-sm" data-testid="guide-mini">
        {stations.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full py-1 pe-3 ps-1.5 text-xs font-bold", ROLE_STYLE[s.who[0]].soft)}>
              <i className={cn("grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] not-italic text-white", ROLE_STYLE[s.who[0]].solid)}>{s.n}</i>
              {t(`station.${s.id}.name`)}
            </span>
            {i < stations.length - 1 && (
              <em className="text-xs not-italic text-muted-foreground" aria-hidden="true">
                <span className="inline-block rtl:rotate-180">→</span>
              </em>
            )}
          </li>
        ))}
      </ol>

      <h2 className="mt-6 flex items-center gap-2 text-base font-black">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">2</span>
        {t("h2.path")}
      </h2>
      <div className="space-y-3" data-testid="guide-stations">
        {stations.map((s) => {
          const links = s.links.filter(allowed)
          return (
            <div key={s.id} data-station={s.id} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
              <span className={cn("z-10 grid h-9 w-9 place-items-center rounded-full text-sm font-black text-white shadow-[0_0_0_4px_hsl(var(--background))]", ROLE_STYLE[s.who[0]].solid)}>{s.n}</span>
              <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <b className="me-1 text-sm">{t(`station.${s.id}.name`)}</b>
                  {s.who.map((r) => (
                    <RoleChip key={r} role={r} />
                  ))}
                </div>
                <p className="mt-1.5 text-[13px] leading-7 text-muted-foreground">{t(s.whatKey, { limit })}</p>
                {s.more.length > 0 && (
                  <ul className="ms-4 mt-1.5 list-disc space-y-0.5 text-xs text-muted-foreground">
                    {s.more.map((m) => (
                      <li key={m}>{t(`more.${m}`)}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed pt-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Eye size={13} aria-hidden="true" />
                    {t(s.seesBy === "pm" ? "sees_pm" : "sees_requester")}: <b className="text-foreground">{t(`sees.${s.sees}`)}</b>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.previewOnly && <span className="text-[11px] text-muted-foreground">{t("preview_only_request")}</span>}
                    {links.map((l) => (
                      <Button key={l.labelKey} asChild variant="outline" size="sm">
                        <Link href={l.href}>{t(l.labelKey)}</Link>
                      </Button>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
