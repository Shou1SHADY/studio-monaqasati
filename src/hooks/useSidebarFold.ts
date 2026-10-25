"use client"

import { useCallback, useEffect, useState } from "react"
import { resolveActiveContractorComponent } from "@/lib/portal-components"

// The sidebar that folds to icons and remembers it (Procurement 2.0 NAV-02, prototype `side-min` + `pf-side`, gap FR-02).
// Procurement's frame folds to icons, and so do Project Management's pages (`/contractor/projects/*`, PM 1.1 UX-01 — the
// prototype gives a project the whole width); every other module keeps today's sidebar that slides away and opens again on
// each page. The two share one remembered choice. Every page mounts its own `PortalLayout`, so the choice lives here — this tab's last choice across page changes, and
// the browser's storage across reloads (read after mount, so the server's and the first client render agree).

const STORAGE_KEY = "pf-side"
let remembered: boolean | null = null

const PROJECTS = "/contractor/projects"

/** Inside one project (not the list, Today, the inbox or a new project) the sidebar starts folded to icons, as the
 * prototype gives a project the whole width (PM 1.1 UX-01) — until the user opens it; that choice is remembered. */
export const startsFolded = (pathname: string): boolean => {
  if (!pathname.startsWith(`${PROJECTS}/`)) return false
  const rest = pathname.slice(PROJECTS.length + 1).split("/")[0]
  return Boolean(rest) && !["today", "inbox", "new"].includes(rest)
}

/** The pages whose sidebar folds to icons instead of sliding away. */
export const foldsToIcons = (pathname: string): boolean =>
  pathname === PROJECTS || pathname.startsWith(`${PROJECTS}/`) || (pathname.startsWith("/contractor") && resolveActiveContractorComponent(pathname).id === "procurement")

/** The user's explicit choice, or null when he never made one. */
function readStored(): boolean | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === "min" ? false : v === "full" ? true : null
  } catch {
    return null
  }
}

/** Props for `SidebarProvider`: controlled and remembered where the sidebar folds, nothing (today's default) elsewhere. */
export function useSidebarFold(active: boolean, foldedByDefault = false): { open?: boolean; onOpenChange?: (open: boolean) => void } {
  // The default depends on the page alone, so the server and the first client render agree (no flash on a project).
  const [open, setOpen] = useState<boolean>(() => remembered ?? !foldedByDefault)
  useEffect(() => {
    if (!active) return
    if (remembered === null) remembered = readStored()
    // No choice made yet: the page's own default (folded inside a project, open elsewhere).
    setOpen(remembered ?? !foldedByDefault)
  }, [active, foldedByDefault])
  const onOpenChange = useCallback((next: boolean) => {
    remembered = next
    setOpen(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "full" : "min")
    } catch {
      // storage refused (a private window): the choice still holds for this tab
    }
  }, [])
  return active ? { open, onOpenChange } : {}
}

/** Tests only: forget this tab's choice. */
export const forgetSidebarFold = () => {
  remembered = null
}
