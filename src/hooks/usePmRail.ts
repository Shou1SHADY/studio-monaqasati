"use client"

// The rail at the head of Project Management's portfolio pages (the PM 1.0
// prototype): Today · Projects · New projects — the last with the count of
// handover files still waiting.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { FolderKanban, Hand, Zap } from "lucide-react"
import type { ModuleTab } from "@/components/module-ui/ModuleHeader"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"

const RED_KEY = "pm.today.red"

export function usePmRail(todayCount?: number): { tabs: ModuleTab[]; orgId: string | null } {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, isOrgOwner } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid || null
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PM_HANDOVERS), where("organizationId", "==", orgId), where("status", "==", "wait")) : null), [firestore, orgId])
  const { data } = useCollection(q)
  const waiting = ((data || []) as PmHandover[]).filter((h) => isOrgOwner || h.to === user?.uid).length

  // Today's red count rides on every portfolio tab: Today computes it, the
  // others show the last one it computed in this session.
  const [remembered, setRemembered] = useState<number | undefined>(undefined)
  useEffect(() => {
    try {
      if (todayCount !== undefined) window.sessionStorage.setItem(RED_KEY, String(todayCount))
      else {
        const v = window.sessionStorage.getItem(RED_KEY)
        if (v !== null) setRemembered(Number(v) || 0)
      }
    } catch {
      /* private browsing */
    }
  }, [todayCount])
  const red = todayCount ?? remembered

  const tabs = useMemo<ModuleTab[]>(
    () => [
      { id: "today", label: t("rail.today"), href: "/contractor/projects/today", icon: Zap, count: red || undefined, urgent: Boolean(red) },
      { id: "projects", label: t("rail.projects"), href: "/contractor/projects", icon: FolderKanban },
      // Hidden when nothing waits — the owner keeps it, to follow returned files.
      ...(waiting > 0 || isOrgOwner ? [{ id: "inbox", label: t("rail.inbox"), href: "/contractor/projects/inbox", icon: Hand, count: waiting, urgent: waiting > 0 }] : []),
    ],
    [t, red, waiting, isOrgOwner]
  )
  return { tabs, orgId }
}
