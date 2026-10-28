"use client"

// The supplier layout's one decision: a company on the free journey gets the live world around its pages inside the
// SAME portal frame everyone works in (PortalLayout — sidebar from the plan's registry, header, app switcher, bell,
// breadcrumbs; the owner's decision of 15 Oct 2026); a company on the full portal gets its pages untouched (each
// brings its own PortalLayout). A free account that reaches a page of the full portal by its address is sent home.

import { useCallback, useMemo, useState, useEffect, type ReactNode } from "react"
import { useRouter, usePathname } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { PortalFrameContext, type PortalFrameExtras } from "@/components/layout/portal-frame-context"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"
import { freePathAllowed } from "@/lib/supplier-plan"
import { FreeOverlays } from "./FreeOverlays"
import { FreeWorldProvider } from "./FreeWorldProvider"
import { freeNavBadges, profileCompletion } from "./home-model"
import { Splash, SupplierPlanContext, type PlanState } from "./PlanSwitch"
import { SubscriptionDialog } from "./SubscriptionDialog"
import { useFree } from "./useFree"
import { useFreeNotifications } from "./useFreeNotifications"

export function SupplierPlanFrame({ children }: { children: ReactNode }) {
  const { plan, loading, orgId, trial } = useSupplierPlan()
  // The pages' PlanSwitch and the portal frame read this answer: one subscription for the layout, never one per page.
  const state = useMemo<PlanState>(() => ({ plan, loading, orgId, trial }), [plan, loading, orgId, trial])
  if (loading) return <Splash />
  return <SupplierPlanContext.Provider value={state}>{plan === "full" ? children : <FreeShell>{children}</FreeShell>}</SupplierPlanContext.Provider>
}

function FreeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const allowed = freePathAllowed(pathname)

  useEffect(() => {
    if (!allowed) router.replace("/supplier")
  }, [allowed, router])

  // Sign-in guards (verified e-mail, the second step) are the portal frame's, as for every account.
  if (!allowed) return <Splash />
  return (
    <FreeWorldProvider>
      <FreeOverlays>
        <FreePortalFrame>{children}</FreePortalFrame>
      </FreeOverlays>
    </FreeWorldProvider>
  )
}

/** The portal frame fed with the free supplier's own numbers: the sidebar's counts (NAV-03), the bell — the
 * notifications page's unread count (MSG-04) — and the search that opens his results page (NAV-04). */
function FreePortalFrame({ children }: { children: ReactNode }) {
  const f = useFree()
  const { unread } = useFreeNotifications()
  const [upgrade, setUpgrade] = useState(false)
  // Opened from a menu: wait for the menu to close so the dialog takes the focus.
  const openSubscription = useCallback(() => {
    window.setTimeout(() => setUpgrade(true), 0)
  }, [])
  // The world logic is rebuilt only when the world changes, so these follow it.
  const pct = useMemo(() => profileCompletion(f.profile), [f.profile])
  const navBadges = useMemo(() => freeNavBadges(f.L.badges(), pct), [f.L, pct])
  const bell = unread.length + f.world.invites.length
  const extras = useMemo<PortalFrameExtras>(
    () => ({
      navBadges,
      bell: { count: bell, href: "/supplier/notifications" },
      search: { path: "/supplier/search", param: "q" },
      hideActivityBell: true,
      hideProfileBanner: true,
      openSubscription,
    }),
    [navBadges, bell, openSubscription]
  )
  return (
    <PortalFrameContext.Provider value={extras}>
      <PortalLayout>{children}</PortalLayout>
      {upgrade && <SubscriptionDialog onClose={() => setUpgrade(false)} />}
    </PortalFrameContext.Provider>
  )
}
