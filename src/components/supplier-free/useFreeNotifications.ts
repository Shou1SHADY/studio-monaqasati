"use client"

// The supplier's notifications (PRD MSG-03/04): each opens its deal, none carries an emoji, "mark all as read",
// and the bell counts the unread deal notifications plus the connection invitations — the same number the page
// shows. An announcement of a public request is information, never an unread notification (it shows as "new" in
// Quote requests instead).

import { useCallback, useMemo } from "react"
import { collection, doc, orderBy, query, updateDoc, writeBatch, limit } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"

export interface FreeNotification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  createdAt: string
  rfqId: string | null
  offerId: string | null
  poId: string | null
  chatId: string | null
  i18n: { title?: string; message?: string; params?: Record<string, string | number> } | null
}

const ANNOUNCEMENTS = new Set(["new_rfq"])

/** Notification text from older writers carried emoji; the free journey writes none and shows none. */
export const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim()

export function useFreeNotifications() {
  const firestore = useFirestore()
  const { user } = useUser()
  const q = useMemoFirebase(() => (firestore && user ? query(collection(firestore, "users", user.uid, "notifications"), orderBy("createdAt", "desc"), limit(200)) : null), [firestore, user])
  const { data } = useCollection<Record<string, unknown>>(q)
  const list = useMemo<FreeNotification[]>(
    () =>
      (data || [])
        .filter((n) => !ANNOUNCEMENTS.has(String(n.type || "")))
        .map((n) => ({
          id: n.id,
          type: String(n.type || ""),
          title: stripEmoji(String(n.title || "")),
          message: stripEmoji(String(n.message || "")),
          read: !!n.read,
          createdAt: String(n.createdAt || ""),
          rfqId: (n.rfqId as string) || null,
          offerId: (n.offerId as string) || null,
          poId: (n.poId as string) || null,
          chatId: (n.chatId as string) || null,
          i18n: (n.i18n as FreeNotification["i18n"]) || null,
        })),
    [data]
  )
  const unread = list.filter((n) => !n.read)
  const markRead = useCallback(
    async (id: string) => {
      if (!firestore || !user) return
      await updateDoc(doc(firestore, "users", user.uid, "notifications", id), { read: true, readAt: new Date().toISOString() }).catch(() => undefined)
    },
    [firestore, user]
  )
  const markAll = useCallback(async () => {
    if (!firestore || !user || !unread.length) return
    const batch = writeBatch(firestore)
    for (const n of unread.slice(0, 400)) batch.update(doc(firestore, "users", user.uid, "notifications", n.id), { read: true, readAt: new Date().toISOString() })
    await batch.commit().catch(() => undefined)
  }, [firestore, user, unread])
  return { list, unread, markRead, markAll }
}
