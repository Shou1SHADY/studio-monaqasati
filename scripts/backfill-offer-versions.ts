// Gives every offer written before Procurement 2.0 its versions: each replaced price (`priceHistory`), oldest first, then the
// live quote — so an old offer reads as V1 and the first edit after this is V2 and keeps what was there. Nothing else on the
// offer changes; an offer that already has `versions` is left alone, so running it twice does nothing the second time.
//
//   npx tsx scripts/backfill-offer-versions.ts uat            — dry run: which offers would get versions
//   npx tsx scripts/backfill-offer-versions.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/backfill-offer-versions.ts uat --apply    — OWNER ONLY, after reading the dry run

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { planVersions } from "../src/lib/procurement/offer-migration"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: backfill-offer-versions.ts <uat|prod> [--apply]")
const apply = argv.includes("--apply")
config({ path: resolve(process.cwd(), target === "uat" ? ".env.uat" : ".env.local") })

async function connect(): Promise<{ db: Firestore; projectId: string }> {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (process.env.FIREBASE_PRIVATE_KEY) {
    if (target === "uat" && projectId !== "mdmaktech-uat") throw new Error(`refusing: .env.uat points at ${projectId}`)
    if (target === "prod" && projectId === "mdmaktech-uat") throw new Error("refusing: .env.local points at UAT")
    if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY as string).replace(/\n/g, "\n") }), projectId })
    return { db: getFirestore(), projectId: projectId as string }
  }
  if (target === "prod") throw new Error("production needs its service account in .env.local")
  const { openUatDb } = await import("./lib/uat-db")
  return { db: openUatDb().db as unknown as Firestore, projectId: "mdmaktech-uat" }
}

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const offers = (await db.collection("offers").get()).docs
  let planned = 0
  for (const doc of offers) {
    const plan = planVersions(doc.data() as Record<string, unknown>)
    if (!plan) continue
    planned++
    console.log(`  ${apply ? "set   " : "would set"} ${doc.id} · ${plan.versions.length} version${plan.versions.length === 1 ? "" : "s"} · ${plan.versions.map((v) => v.total).join(" → ")}`)
    if (apply) await doc.ref.update({ versions: plan.versions, rev: plan.rev })
  }
  console.log(`\n${offers.length} offers, ${planned} ${apply ? "given versions" : "would be given versions"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
