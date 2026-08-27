import { IS_UAT } from "@/lib/app-env"

/**
 * Web SDK config, from the NEXT_PUBLIC_FIREBASE_* variables each App Hosting
 * backend bakes in at build time (see apphosting.yaml / apphosting.uat.yaml).
 *
 * Production values remain as fallbacks so a plain local checkout still runs.
 * On UAT that fallback is refused: a UAT build that quietly talked to the
 * production project would be worse than one that fails to start.
 */
const PROD_FALLBACK = {
  projectId: "studio-2889504658-6ee2a",
  appId: "1:374877124985:web:c7e928b56b265e9a2597a8",
  apiKey: "AIzaSyBLc-jwwFrCiklo8h9UCH9dIgF2ALUQCLw",
  authDomain: "studio-2889504658-6ee2a.firebaseapp.com",
  measurementId: "",
  messagingSenderId: "374877124985",
  storageBucket: "studio-2889504658-6ee2a.firebasestorage.app",
}

function pick(name: string, fallback: string): string {
  const value = process.env[name]
  if (value) return value
  if (IS_UAT) {
    throw new Error(`[firebase] ${name} is not set — a UAT build must not fall back to the production project`)
  }
  return fallback
}

export const firebaseConfig = {
  projectId: pick("NEXT_PUBLIC_FIREBASE_PROJECT_ID", PROD_FALLBACK.projectId),
  appId: pick("NEXT_PUBLIC_FIREBASE_APP_ID", PROD_FALLBACK.appId),
  apiKey: pick("NEXT_PUBLIC_FIREBASE_API_KEY", PROD_FALLBACK.apiKey),
  authDomain: pick("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", PROD_FALLBACK.authDomain),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || PROD_FALLBACK.measurementId,
  messagingSenderId: pick("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", PROD_FALLBACK.messagingSenderId),
  storageBucket: pick("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", PROD_FALLBACK.storageBucket),
}
