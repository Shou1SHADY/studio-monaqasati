"use client"

// Radix primitives (Tabs, RadioGroup, ToggleGroup, menus, Slider, ScrollArea…) do not read the page's `dir`: without a
// direction they stamp `dir="ltr"` on their own root, so a Tabs block on an Arabic page laid itself out left-to-right
// (the RFQ page, review 1 #1). One provider at the locale layout gives every primitive the page's direction; an explicit
// `dir` prop on a component still wins.

import type { ReactNode } from "react"
import { DirectionProvider } from "@radix-ui/react-direction"

export function RadixDirection({ locale, children }: { locale: string; children: ReactNode }) {
  return <DirectionProvider dir={locale === "ar" ? "rtl" : "ltr"}>{children}</DirectionProvider>
}
