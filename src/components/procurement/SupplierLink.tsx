"use client"

// A supplier's name as a link on every screen (prototype `supLink`/`sup-open`, SP-03): pressing it opens his file IN PLACE — stacked over
// the drawer the buyer is working in, and closing it returns him there (the prototype's `S.drBack`) — instead of navigating away to the
// Suppliers page. A page that already holds the file drawer (Suppliers) provides `SupplierLinkContext` and the link opens THAT drawer;
// anywhere else the link mounts its own `SupplierFileHost` only once pressed. One of ours opens our file (read here: managing him stays on
// the Suppliers page); one not ours yet opens the directory's profile with «أضِفه إلى موردينا». An off-platform supplier with no account
// (a guest key) has no profile to open and stays plain text. The deep link `?supplier=` keeps working for notifications.

import { Suspense, createContext, lazy, useContext, useState } from "react"
import { cn } from "@/lib/utils"
import { isGuestSupplierKey } from "@/lib/procurement/supplier-offplatform"

// The file and its data hooks load only once a name is pressed.
const SupplierFileHost = lazy(() => import("./SupplierFileHost"))

/** Set by a page that renders the supplier file itself: the link hands it the supplier's id. */
export const SupplierLinkContext = createContext<((orgId: string) => void) | null>(null)

/** Whether a name can open a file: a platform supplier's id, never a guest key or a bare name. */
export const linkableSupplier = (orgId: string | null | undefined, name?: string | null): orgId is string => Boolean(orgId && orgId !== name && !isGuestSupplierKey(orgId))

export function SupplierLink({ orgId, name, className }: { orgId: string | null | undefined; name: string | null | undefined; className?: string }) {
  const openInPage = useContext(SupplierLinkContext)
  const [hosted, setHosted] = useState<string | null>(null)
  const text = name || "—"
  if (!linkableSupplier(orgId, name)) {
    return (
      <span className={className} dir="auto">
        {text}
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (openInPage) openInPage(orgId)
          else setHosted(orgId)
        }}
        className={cn("rounded text-start text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        dir="auto"
      >
        {text}
      </button>
      {hosted && (
        <Suspense fallback={null}>
          <SupplierFileHost orgId={hosted} onClose={() => setHosted(null)} />
        </Suspense>
      )}
    </>
  )
}
