// Append-only team audit log. Client-side writes are fire-and-forget: an
// activity entry must never block or fail the action it describes.

import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore"

export type TeamActivityType =
  | "invite_sent"
  | "member_joined"
  | "member_removed"
  | "member_group_changed"
  | "group_created"
  | "group_updated"
  | "group_deleted"
  | "project_member_added"
  | "project_member_removed"

export interface TeamActivityInput {
  organizationId: string
  type: TeamActivityType
  actorId: string
  actorName: string
  /** Person/group/project the action was applied to, for display. */
  targetName?: string
}

export function logTeamActivity(firestore: Firestore, entry: TeamActivityInput): void {
  addDoc(collection(firestore, "teamActivity"), {
    ...entry,
    targetName: entry.targetName || null,
    createdAt: serverTimestamp(),
  }).catch((err) => console.error("Failed to log team activity:", err))
}
