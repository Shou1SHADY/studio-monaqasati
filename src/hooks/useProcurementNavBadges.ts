"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { useUser } from "@/firebase"
import { unreadChatCount, type PoWithChat } from "@/lib/procurement/po-messages"
import { noticesToForward, procNavBadges, publishProcNavBadges, readProcNavBadges, serverProcNavBadges, subscribeProcNavBadges, type ProcNavBadges } from "@/lib/procurement/nav-badges"
import type { ProcurementShell } from "@/hooks/useProcurementShell"

/** «محادثاتي» in the sidebar: the conversations with something unread (MSG-02). */
export const CHATS_HREF = "/contractor/chats"

/** The page head's side: turns the numbers it already derived into the sidebar's counts and publishes them. */
export function useProcurementNavBadges(shell: Pick<ProcurementShell, "loading" | "counts" | "loaded">): ProcNavBadges {
  const { user } = useUser()
  const uid = user?.uid || ""
  const unreadChats = useMemo(() => (uid ? unreadChatCount(shell.loaded.orders as PoWithChat[], uid) : 0), [shell.loaded.orders, uid])
  const badges = useMemo(
    () => ({ ...procNavBadges(shell.counts, noticesToForward(shell.loaded.deliveries)), ...(unreadChats ? { [CHATS_HREF]: { n: unreadChats, tone: "red" as const } } : {}) }),
    [shell.counts, shell.loaded.deliveries, unreadChats]
  )
  const { loading } = shell
  useEffect(() => {
    if (!loading) publishProcNavBadges(badges)
  }, [loading, badges])
  return badges
}

/** The sidebar's side: the counts the last Procurement page published (none until one has). */
export const useProcurementNavBadgeFeed = (): ProcNavBadges => useSyncExternalStore(subscribeProcNavBadges, readProcNavBadges, serverProcNavBadges)
