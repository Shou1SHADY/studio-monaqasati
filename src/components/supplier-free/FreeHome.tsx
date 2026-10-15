"use client"

// The free supplier's home is the portal home every account lands on (PortalHomeView — the owner's decision of 15 Oct
// 2026): the greeting with his three figures (TDY-01), a tile per module — the subscription's ones locked, saying what
// it adds — and "Needs your reply" as the day's decisions in the one working order (G-12), each opening its deal over
// the page that owns it. A new account sees "nothing yet" and how to complete its profile, never zeros (TDY-07).

import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { PortalHomeView } from "@/components/portal-home/PortalHomeView"
import { useModuleComponents } from "@/hooks/useCompanyModules"
import { freeHomeModel } from "./home-model"
import { useFree } from "./useFree"

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
      banner={banner}
    />
  )
}
