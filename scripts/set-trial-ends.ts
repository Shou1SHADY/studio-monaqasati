// Gives the contractors marked «trial» BEFORE trials had a length an end date — until they have one a trial never runs out.
// A trial whose end is stored as text only (no `trialEndsMs`, which the security rules read) is completed from that text.
// Never touches a company that is Active, and never moves an end date that is already set.
//
//   npx tsx scripts/set-trial-ends.ts uat                — dry run: which trials would change, and how
//   npx tsx scripts/set-trial-ends.ts prod               — the same for production (service account in .env.local)
//   npx tsx scripts/set-trial-ends.ts uat --apply        — OWNER ONLY, after reading the dry run
//   --days <n>       the length given to a trial with no end, counted from now (default 14)
//   --to-active      turn a trial with no end into Active instead
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { NO_TRIAL_WINDOW, TRIAL_DEFAULT_DAYS, parseTrialDays, trialWindow } from "../src/lib/subscription-status"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: set-trial-ends.ts <uat|prod> [--apply] [--days n | --to-active] [--org <orgId> ...]")
const apply = argv.includes("--apply")
const toActive = argv.includes("--to-active")
const days = argv.includes("--days") ? parseTrialDays(argv[argv.indexOf("--days") + 1] ?? "") : TRIAL_DEFAULT_DAYS
if (days === null) throw new Error("--days must be a whole number from 1 to 365")
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
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"} · ${toActive ? "no-end trials become Active" : `no-end trials get ${days} days from now`}
`)
  const docs = (await db.collection("companyModules").where("subscription", "==", "trial").get()).docs
  let changed = 0
  for (const d of docs) {
    if (only.length && !only.includes(d.id)) continue
    const row = d.data() as { trialEndsAt?: unknown; trialEndsMs?: unknown }
    const text = typeof row.trialEndsAt === "string" ? Date.parse(row.trialEndsAt) : NaN
    let patch: Record<string, unknown> | null = null
    let note = ""
    if (!Number.isNaN(text)) {
      if (typeof row.trialEndsMs === "number") {
        console.log(`  keep   ${d.id} · ends ${row.trialEndsAt}`)
        continue
      }
      patch = { trialEndsMs: text }
      note = `complete the end ${row.trialEndsAt}`
    } else if (toActive) {
      patch = { subscription: "active", ...NO_TRIAL_WINDOW }
      note = "no end → Active"
    } else {
      const w = trialWindow(days as number, new Date())
      patch = { ...w }
      note = `no end → ${w.trialDays} days, ends ${w.trialEndsAt}`
    }
    changed++
    console.log(`  ${apply ? "set   " : "would set"} ${d.id} · ${note}`)
    if (apply) await d.ref.set({ ...patch, updatedById: "script", updatedByName: "set-trial-ends", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  console.log(`
${docs.length} trials, ${changed} ${apply ? "changed" : "would change"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
