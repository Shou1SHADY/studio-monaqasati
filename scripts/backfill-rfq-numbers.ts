// Numbers the RFQs raised before RFQs were numbered (Supplier 1.0 NAV-08 / G-10): per company and per year of
// creation, oldest first, `RFQ-yyyy/NNN` after whatever that year's counter (`mfgCounters/{org}__RFQ__{year}`)
// already holds, and the counter moves to the last number given. An RFQ that has a number keeps it. Each company-year
// is ONE transaction that re-reads the counter and the RFQs, so an RFQ created meanwhile is never given a used number.
//
//   npx tsx scripts/backfill-rfq-numbers.ts uat            — dry run: which RFQs would get which number
//   npx tsx scripts/backfill-rfq-numbers.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/backfill-rfq-numbers.ts uat --apply    — OWNER ONLY, after reading the dry run
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { planRfqNumbers, type BackfillRfq } from "../src/lib/procurement/rfq-number-backfill"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: backfill-rfq-numbers.ts <uat|prod> [--apply] [--org <orgId> ...]")
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

const iso = (v: unknown): string | null => {
  if (typeof v === "string") return v
  if (v && typeof v === "object" && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString()
  return null
}

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const rows: BackfillRfq[] = (await db.collection("rfqs").get()).docs
    .map((d) => {
      const x = d.data() as { organizationId?: string; contractorId?: string; createdAt?: unknown; rfqNumber?: string }
      return { id: d.id, organizationId: x.organizationId || null, contractorId: x.contractorId || null, createdAt: iso(x.createdAt), rfqNumber: x.rfqNumber || null }
    })
    .filter((r) => !only.length || only.includes(r.organizationId || r.contractorId || ""))
  const counterIds = [...new Set(planRfqNumbers(rows, {}, new Date().getUTCFullYear()).map((g) => g.counterId))]
  const counters: Record<string, number> = {}
  for (const id of counterIds) counters[id] = Number((await db.collection("mfgCounters").doc(id).get()).data()?.last) || 0
  const plan = planRfqNumbers(rows, counters, new Date().getUTCFullYear())
  let total = 0
  for (const g of plan) {
    console.log(`${g.orgId} · ${g.year} · counter at ${g.from} → ${g.from + g.assign.length}`)
    for (const a of g.assign) console.log(`  ${apply ? "set      " : "would set"} ${a.id} → ${a.rfqNumber}`)
    total += g.assign.length
    if (!apply) continue
    // Re-read inside a transaction: a counter that moved meanwhile, or an RFQ numbered meanwhile, stops this group.
    await db.runTransaction(async (tx) => {
      const counterRef = db.collection("mfgCounters").doc(g.counterId)
      const cur = Number((await tx.get(counterRef)).data()?.last) || 0
      if (cur !== g.from) throw new Error(`${g.counterId} moved from ${g.from} to ${cur} — run again`)
      const refs = g.assign.map((a) => db.collection("rfqs").doc(a.id))
      const snaps = await Promise.all(refs.map((r) => tx.get(r)))
      if (snaps.some((s) => (s.data() as { rfqNumber?: string } | undefined)?.rfqNumber)) throw new Error(`an RFQ of ${g.counterId} was numbered meanwhile — run again`)
      g.assign.forEach((a, k) => tx.update(refs[k], { rfqNumber: a.rfqNumber }))
      tx.set(counterRef, { organizationId: g.orgId, type: "RFQ", year: g.year, last: g.from + g.assign.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
  }
  console.log(`\n${rows.length} RFQs read, ${total} ${apply ? "numbered" : "would be numbered"} in ${plan.length} company-years`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
