"use client"

import { useCallback, useEffect, useState } from "react"
import { resolveActiveContractorComponent } from "@/lib/portal-components"

// The sidebar that folds to icons and remembers it (Procurement 2.0 NAV-02, prototype `side-min` + `pf-side`, gap FR-02).
// Only Procurement's frame folds to icons; every other module keeps today's sidebar that slides away and opens again on each
// page. Every page mounts its own `PortalLayout`, so the choice lives here — this tab's last choice across page changes, and
// the browser's storage across reloads (read after mount, so the server's and the first client render agree).

const STORAGE_KEY = "pf-side"
let remembered: boolean | null = null

/** The pages whose sidebar folds to icons instead of sliding away. */
export const foldsToIcons = (pathname: string): boolean => pathname.startsWith("/contractor") && resolveActiveContractorComponent(pathname).id === "procurement"

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "min"
  } catch {
    return true
  }
}

/** Props for `SidebarProvider`: controlled and remembered where the sidebar folds, nothing (today's default) elsewhere. */
export function useSidebarFold(active: boolean): { open?: boolean; onOpenChange?: (open: boolean) => void } {
  const [open, setOpen] = useState<boolean>(() => remembered ?? true)
  useEffect(() => {
    if (!active) return
    if (remembered === null) remembered = readStored()
    setOpen(remembered)
  }, [active])
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
