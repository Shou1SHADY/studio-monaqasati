"use client"

// What a plan adds to the one portal frame. A free supplier's pages live inside PortalLayout like everyone else's; the
// frame then reads from here the numbers his own screens show (the sidebar's counts, the bell) and where his search
// goes. Nothing provides it on the contractor portal or the full supplier portal, and with nothing provided every
// piece of the frame behaves exactly as it always did.

import { createContext, useContext } from "react"
import type { NavBadge } from "@/lib/portal-components"

export interface PortalFrameExtras {
  /** A count beside a sidebar item, keyed by the item's href (NAV-03). */
  navBadges?: Readonly<Record<string, NavBadge>>
  /** The bell as a link to the notifications page, with that page's unread count (MSG-04). */
  bell?: { count: number; href: string }
  /** Where the header's search box sends a query (NAV-04): `${path}?${param}=…`. */
  search?: { path: string; param: string }
  /** The frame leaves out the to-do bell (My to-dos is not part of this plan). */
  hideActivityBell?: boolean
  /** The plan has its own way to complete the profile (ACC-04, TDY-07): no banner over every page. */
  hideProfileBanner?: boolean
  /** Opens "what a subscription adds" (SUB-02) — from a locked tile or the user menu, never inside a workflow. */
  openSubscription?: () => void
}

export const PortalFrameContext = createContext<PortalFrameExtras | null>(null)

/** The plan's additions to the frame, or null (the frame as it always was). */
export const usePortalFrame = () => useContext(PortalFrameContext)
