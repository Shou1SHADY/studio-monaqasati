// Puts the supplier companies that ALREADY exist on the full portal, so the free journey (Supplier 1.0) changes
// nothing for them. A supplier company with no `companyPlans` document is free by default — a supplier a contractor
// adds from now on — and the platform admin switches any company in Components. Never overwrites a plan that is set.
//
//   npx tsx scripts/set-supplier-plans.ts uat            — dry run: which companies would be set to "full"
//   npx tsx scripts/set-supplier-plans.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/set-supplier-plans.ts uat --apply    — OWNER ONLY, after reading the dry run
//   --plan free      sets "free" instead (for a company that must start on the free journey)
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: set-supplier-plans.ts <uat|prod> [--apply] [--plan full|free] [--org <orgId> ...]")
const apply = argv.includes("--apply")
const planArg = argv.includes("--plan") ? argv[argv.indexOf("--plan") + 1] : "full"
if (planArg !== "full" && planArg !== "free") throw new Error("--plan must be full or free")
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
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"} · plan "${planArg}"\n`)
  const users = (await db.collection("users").where("role", "==", "Supplier").get()).docs
  const orgs = new Map<string, string>()
  for (const u of users) {
    const d = u.data() as { organizationId?: string; companyName?: string; name?: string; organizationRole?: string }
    const org = d.organizationId || u.id
    if (only.length && !only.includes(org)) continue
    if (!orgs.has(org) || org === u.id) orgs.set(org, d.companyName || d.name || u.id)
  }
  let planned = 0
  for (const [org, name] of orgs) {
    const ref = db.collection("companyPlans").doc(org)
    const snap = await ref.get()
    if (snap.exists) {
      console.log(`  keep   ${org} · ${name} · already "${(snap.data() as { supplierPlan?: string }).supplierPlan}"`)
      continue
    }
    planned++
    console.log(`  ${apply ? "set   " : "would set"} ${org} · ${name} → ${planArg}`)
    if (apply) await ref.set({ organizationId: org, supplierPlan: planArg, updatedById: "script", updatedByName: "set-supplier-plans", updatedAt: FieldValue.serverTimestamp() })
  }
  console.log(`\n${orgs.size} supplier companies, ${planned} ${apply ? "set" : "would be set"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
