"use client"

// What opens over any page by its address: the deal drawer (`?deal=`) and the quote form (`?quote=`). Both sit inside
// the actions provider so any button in either can open its window.

import type { ReactNode } from "react"
import { ActionsProvider } from "./ActionsProvider"
import { DealDrawer } from "./DealDrawer"
import { QuoteDialog } from "./QuoteDialog"

export function FreeOverlays({ children }: { children: ReactNode }) {
  return (
    <ActionsProvider>
      {children}
      <DealDrawer />
      <QuoteDialog />
    </ActionsProvider>
  )
}
