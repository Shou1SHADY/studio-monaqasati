import { getApps, initializeApp, cert, App } from "firebase-admin/app"
import { getAuth, Auth } from "firebase-admin/auth"
import { getFirestore, Firestore } from "firebase-admin/firestore"

// Server-only — never import this file in client components.
// Credentials come from server-only env vars (no NEXT_PUBLIC_ prefix).
function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores the key as a single-line string with literal \n sequences.
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  })
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}
