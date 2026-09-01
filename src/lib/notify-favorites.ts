"use client"

import type { User } from "firebase/auth"

// Fire-and-forget: tell the server a publish just happened so favorited
// suppliers get their SMS. Never blocks or fails the publish itself.
export async function notifyFavoriteSuppliersOfPublish(user: User | null | undefined, rfqIds: string[]) {
  if (!user || rfqIds.length === 0) return
  try {
    const token = await user.getIdToken()
    await fetch("/api/rfq-published/notify-favorites", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rfqIds }),
    })
  } catch (err) {
    console.error("Failed to notify favorite suppliers:", err)
  }
}
