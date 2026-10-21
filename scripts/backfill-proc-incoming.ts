// Builds the stored incoming requests (`procIncoming`, Procurement 2.0 WP-S2-03) from what a company already has: the team's
// «طلب مواد» of the old collection `procTeamRequests` (each moved across once and marked `migrated`), the project requests the
// project manager approved, and the work orders' shortfalls. Each request's lines are read against the RFQs and orders that name
// them, so a request already in an RFQ or an order starts there (a partly awarded one starts as «جزء منه» with its remainder to
// buy), and its state is derived from its lines. Idempotent: a request that already has its document is only re-read, never
// duplicated, and a workshop shortfall draws its `MAT-yyyy/NNN` number once.
//
//   npx tsx scripts/backfill-proc-incoming.ts uat            — dry run: what would be built, per company
//   npx tsx scripts/backfill-proc-incoming.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/backfill-proc-incoming.ts uat --apply    — OWNER ONLY, after reading the dry run
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { orgsToSync, planIncoming, syncIncoming } from "../src/lib/procurement/incoming-server"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: backfill-proc-incoming.ts <uat|prod> [--apply] [--org <orgId> ...]")
const apply = argv.includes("--apply")
const only = argv.flatMap((a, i) => (a === "--org" ? [argv[i + 1]] : []))
config({ path: resolve(process.cwd(), target === "uat" ? ".env.uat" : ".env.local") })

async function connect(): Promise<{ db: Firestore; projectId: string }> {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (process.env.FIREBASE_PRIVATE_KEY) {
    if (target === "uat" && projectId !== "mdmaktech-uat") throw new Error(`refusing: .env.uat points at ${projectId}`)
    if (target === "prod" && projectId === "mdmaktech-uat") throw new Error("refusing: .env.local points at UAT")
    if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY as string).replace(/\\n/g, "\n") }), projectId })
    return { db: getFirestore(), projectId: projectId as string }
  }
  if (target === "prod") throw new Error("production needs its service account in .env.local")
  const { openUatDb } = await import("./lib/uat-db")
  return { db: openUatDb().db as unknown as Firestore, projectId: "mdmaktech-uat" }
}

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const orgs = (await orgsToSync(db)).filter((id) => !only.length || only.includes(id))
  let legacy = 0
  let pm = 0
  let mfg = 0
  for (const orgId of orgs) {
    const plan = await planIncoming(db, orgId)
    const total = plan.legacy + plan.pm + plan.mfg
    if (!total && !apply) continue
    console.log(`${orgId} · team ${plan.legacy} · projects ${plan.pm} · workshop ${plan.mfg} · states ${JSON.stringify(plan.states)}`)
    legacy += plan.legacy
    pm += plan.pm
    mfg += plan.mfg
    if (!apply) continue
    const done = await syncIncoming(db, orgId)
    console.log(`  built ${done.created} · moved across ${done.migrated} · re-read ${done.refreshed}`)
  }
  console.log(`\n${orgs.length} companies · ${legacy} team requests, ${pm} project requests, ${mfg} workshop shortfalls ${apply ? "built" : "would be built"}`)
  if (!apply) console.log("Run again with --apply to write them. Nothing leaves procTeamRequests: its documents are marked `migrated`, not deleted.")
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
