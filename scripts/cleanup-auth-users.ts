/**
 * Finds Firebase Auth accounts that have no matching Firestore `users` doc and deletes them.
 *
 * Usage:
 *   npx tsx scripts/cleanup-auth-users.ts           # dry-run (safe, prints only)
 *   npx tsx scripts/cleanup-auth-users.ts --delete  # actually delete orphaned accounts
 */

import { config } from "dotenv"
import { resolve } from "path"

config({ path: resolve(process.cwd(), ".env.local") })

import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

function initAdmin() {
  if (getApps().length > 0) return getApps()[0]!

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")

  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }

  return initializeApp({ credential: applicationDefault(), projectId })
}

async function main() {
  const shouldDelete = process.argv.includes("--delete")

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    console.error(`
ERROR: Firebase Admin credentials not found in environment.

Option 1 — set env vars before running:
  FIREBASE_PROJECT_ID=your-project \\
  FIREBASE_CLIENT_EMAIL=sa@your-project.iam.gserviceaccount.com \\
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n..." \\
  npx tsx scripts/cleanup-auth-users.ts

Option 2 — use the API endpoint from the browser console while signed in as admin:
  See instructions printed by the Next.js dev server route /api/admin/auth-cleanup
    `)
    process.exit(1)
  }

  const app = initAdmin()
  const auth = getAuth(app)
  const db   = getFirestore(app)

  // 1. Collect all Firestore users doc IDs
  console.log("Fetching Firestore users collection...")
  const usersSnap = await db.collection("users").get()
  const firestoreUids = new Set(usersSnap.docs.map(d => d.id))
  console.log(`  ${firestoreUids.size} Firestore user docs found.`)

  // 2. Paginate through all Auth users
  console.log("Fetching Firebase Auth users...")
  const authUids: string[] = []
  let pageToken: string | undefined

  do {
    const result = await auth.listUsers(1000, pageToken)
    for (const user of result.users) {
      authUids.push(user.uid)
    }
    pageToken = result.pageToken
  } while (pageToken)

  console.log(`  ${authUids.length} Auth accounts found.`)

  // 3. Find orphans
  const orphans = authUids.filter(uid => !firestoreUids.has(uid))

  if (orphans.length === 0) {
    console.log("\nNo orphaned Auth accounts found. Nothing to do.")
    return
  }

  console.log(`\n${orphans.length} orphaned Auth account(s) (in Auth but NOT in Firestore users):`)
  for (const uid of orphans) {
    // Fetch the Auth user to show email for context
    const user = await auth.getUser(uid)
    console.log(`  - ${uid}  (${user.email ?? "no email"}  created: ${user.metadata.creationTime})`)
  }

  if (!shouldDelete) {
    console.log("\nDRY RUN — pass --delete to actually delete these accounts.")
    return
  }

  // 4. Delete orphans
  console.log("\nDeleting orphaned accounts...")
  let deleted = 0
  let failed  = 0

  for (const uid of orphans) {
    try {
      await auth.deleteUser(uid)
      console.log(`  deleted ${uid}`)
      deleted++
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string }
      if (e.code === "auth/user-not-found") {
        console.log(`  already gone: ${uid}`)
        deleted++
      } else {
        console.error(`  FAILED to delete ${uid}: ${e.message}`)
        failed++
      }
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`)
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(1)
})
