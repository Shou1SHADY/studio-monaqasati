"use client"

// The free supplier's home is the portal home every account lands on (PortalHomeView — the owner's decision of 15 Oct
// 2026): the greeting with his three figures (TDY-01), a tile per module — the subscription's ones locked, saying what
// it adds — and "Needs your reply" as the day's decisions in the one working order (G-12), each opening its deal over
// the page that owns it. A new account sees "nothing yet" and how to complete its profile, never zeros (TDY-07).

import { SpecialtiesPrompt } from "@/components/materials/SpecialtiesPrompt"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { PortalHomeView } from "@/components/portal-home/PortalHomeView"
import { useModuleComponents } from "@/hooks/useCompanyModules"
import { freeHomeModel } from "./home-model"
import { RequestCard } from "./RequestCard"
import { useFree } from "./useFree"

/** A request card on the home opens over the Quote requests page, as it does there. */
const rfqsHref = (patch: Record<string, string | null>) => {
  const qs = new URLSearchParams(Object.entries(patch).filter((e): e is [string, string] => !!e[1])).toString()
  return `/supplier/rfqs${qs ? `?${qs}` : ""}`
}

export function FreeHome() {
  const f = useFree()
  const modules = useModuleComponents("supplier")
  const m = freeHomeModel(f)
  const { t, profile, world } = f
  // The home waits for the world (its skeleton) instead of showing an empty one first.
  const homeProfile = f.ready && profile ? { ...profile.raw, name: profile.name, companyName: profile.companyName } : null
  const linked = world.deals.find((d) => d.offer) || world.deals[0]
  const linkedName = linked ? f.L.C(linked.c)?.name || "" : ""

  const banner = m.fresh ? (
    <section aria-label={t("nothingYet")} className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed bg-card px-4 py-4">
      <div className="min-w-0 flex-1 basis-60">
        <b className="block text-sm font-bold">{t("nothingYet")}</b>
        {linkedName && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("welX", { c: linkedName })}</p>}
      </div>
      {m.pct < 100 && (
        <Button asChild size="sm">
          <Link href="/supplier/profile">{t("profComplete")}</Link>
        </Button>
      )}
    </section>
  ) : null

  // Open requests (TDY-05): the four closing soonest, counted as the Quote requests page counts them.
  const open = f.ready ? f.L.opps({}) : []
  const openSection =
    open.length > 0 ? (
      <section aria-labelledby="home-open-reqs" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="home-open-reqs" className="flex items-center gap-2 text-sm font-black text-foreground">
            {t("okOpen")}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{f.fmt.n(open.length)}</span>
          </h2>
          <Link href="/supplier/rfqs" className="rounded text-[12.5px] font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("seeAllOpps")}
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {open.slice(0, 4).map((d) => (
            <RequestCard key={d.id} f={f} d={d} href={rfqsHref} />
          ))}
        </div>
      </section>
    ) : null

  return (
    <PortalHomeView
      profile={homeProfile}
      orgId={profile?.orgId}
      companyName={profile?.companyName}
      modules={modules}
      kpis={m.kpis}
      tileStats={m.tileStats}
      badges={m.badges}
      urgentTiles={m.urgentTiles}
      recent={[]}
      decisions={{ loading: !f.ready, items: m.decisions }}
      banner={
        f.ready && profile && !(profile.specialtyIds || []).length ? (
          <div className="space-y-3">
            <SpecialtiesPrompt />
            {banner}
          </div>
        ) : (
          banner
        )
      }
      allDecisions={{ all: t("secAll", { n: f.fmt.n(m.decisions.length) }), fewer: t("secFewer") }}
      after={openSection}
      decisionsFirstOnPhone
    />
  )
}
