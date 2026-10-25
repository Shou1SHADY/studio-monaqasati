// The Admin-SDK store the handover acceptance runs over (handover-accept.ts) —
// server only: /api/pm/handover-accept.

import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import type { AcceptStore } from "./handover-accept"

export function adminAcceptStore(db: Firestore): AcceptStore {
  return {
    run: (fn) =>
      db.runTransaction((t) =>
        fn({
          get: async (path) => {
            const s = await t.get(db.doc(path))
            return s.exists ? ((s.data() ?? {}) as Record<string, unknown>) : null
          },
          set: (path, data) => {
            t.set(db.doc(path), data)
          },
          update: (path, data) => {
            t.update(db.doc(path), data as UpdateData<DocumentData>)
          },
        })
      ),
    newId: (collection) => db.collection(collection).doc().id,
    stamp: () => FieldValue.serverTimestamp(),
  }
}
