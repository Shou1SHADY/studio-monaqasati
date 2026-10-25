"use client"

import { useTranslations } from "next-intl"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

export function SidebarToggle() {
  const t = useTranslations("Portal.Layout")
  const { state } = useSidebar()
  const label = t(state === "expanded" ? "collapse_menu" : "expand_menu")
  return <SidebarTrigger title={label} aria-label={label} />
}
