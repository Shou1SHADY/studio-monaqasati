import { getApps, initializeApp, cert, applicationDefault, App } from "firebase-admin/app"
import { getAuth, Auth } from "firebase-admin/auth"
import { getFirestore, Firestore } from "firebase-admin/firestore"
import { getStorage, Storage } from "firebase-admin/storage"

// Server-only — never import this file in client components.
// Credentials come from server-only env vars (no NEXT_PUBLIC_ prefix).
// Local dev without env vars: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON,
// or run `gcloud auth application-default login` and set FIREBASE_PROJECT_ID.
function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  // Vercel stores the key as a single-line string with literal \n sequences.
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")

  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }

  // Fallback: Application Default Credentials
  // Works when GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON,
  // or inside GCP/Firebase Hosting environments.
  return initializeApp({
    credential: applicationDefault(),
    projectId,
  })
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp())
}

// Same bucket the client SDK writes to (see src/firebase/config.ts). The
// production fallback is refused on UAT for the same reason as there.
export function getStorageBucketName(): string {
  const configured = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  if (configured) return configured
  if (process.env.NEXT_PUBLIC_APP_ENV === "uat") {
    throw new Error("[firebase-admin] FIREBASE_STORAGE_BUCKET is not set — a UAT server must not fall back to the production bucket")
  }
  return "studio-2889504658-6ee2a.firebasestorage.app"
}
