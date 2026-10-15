"use client"

// What opens over any page by its address: the deal drawer (`?deal=`) and the quote form (`?quote=`). Both sit inside
// the actions provider so any button in either can open its window. A quote form opened by its address before the
// world has loaded waits behind a loader instead of popping in late (NAV-06).

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ActionsProvider } from "./ActionsProvider"
import { DealDrawer } from "./DealDrawer"
import { QuoteDialog } from "./QuoteDialog"
import { useQueryState } from "./ui"
import { useFree } from "./useFree"

function QuoteLoading() {
  const f = useFree()
  const q = useQueryState()
  if (!q.get("quote")) return null
  return (
    <Dialog open onOpenChange={(o) => !o && q.set({ quote: null, mode: null })}>
      <DialogContent className="max-w-sm" aria-busy="true">
        <DialogTitle className="sr-only">{f.t("loadingWorld")}</DialogTitle>
        <DialogDescription className="sr-only">{f.t("loadingWorld")}</DialogDescription>
        <div className="grid place-items-center py-10" role="status">
          <Loader2 size={24} className="animate-spin text-module" aria-hidden="true" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FreeOverlays({ children }: { children: ReactNode }) {
  const { ready } = useFree()
  return (
    <ActionsProvider>
      {children}
      <DealDrawer />
      {ready ? <QuoteDialog /> : <QuoteLoading />}
    </ActionsProvider>
  )
}
