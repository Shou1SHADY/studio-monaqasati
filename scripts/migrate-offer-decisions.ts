// Moves the buyer's decisions out of the offer's `status` (Procurement 2.0, G-15). An offer with status «مرفوض» becomes an
// exclusion in its own record (`offerDecisions/{offerId}`: spec→spec, lead→validity, the rest «other» with the old word as its
// text) and goes back to «قيد المراجعة»; one with «مطلوب تخفيض» carries a `bafo` request instead; one whose cut was answered
// gets the answered `bafo`. Everything reads both shapes until this runs, so it is safe to run late and safe to run twice.
//
//   npx tsx scripts/migrate-offer-decisions.ts uat            — dry run: which offers would move
//   npx tsx scripts/migrate-offer-decisions.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/migrate-offer-decisions.ts uat --apply    — OWNER ONLY, after reading the dry run

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { planDecisionMove } from "../src/lib/procurement/offer-migration"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: migrate-offer-decisions.ts <uat|prod> [--apply]")
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
  let excluded = 0
  let asked = 0
  let answered = 0
  const rfqs = new Map<string, { organizationId: string }>()
  for (const doc of offers) {
    const data = doc.data() as Record<string, unknown>
    const move = planDecisionMove(data)
    if (!move) continue
    const rfqId = String(data.rfqId || "")
    if (!rfqs.has(rfqId)) {
      const r = rfqId ? (await db.collection("rfqs").doc(rfqId).get()).data() : undefined
      rfqs.set(rfqId, { organizationId: String(r?.organizationId || r?.contractorId || data.contractorOrgId || "") })
    }
    const kind = move.decision ? "exclusion" : (move.offerPatch.bafo as { answered: unknown } | undefined)?.answered ? "answered cut" : "better-price request"
    if (move.decision) excluded++
    else if (kind === "answered cut") answered++
    else asked++
    console.log(`  ${apply ? "move  " : "would move"} ${doc.id} · ${kind}`)
    if (!apply) continue
    if (move.decision) {
      const at = new Date().toISOString()
      await db.collection("offerDecisions").doc(doc.id).set({ offerId: doc.id, rfqId, organizationId: rfqs.get(rfqId)?.organizationId || "", shortlist: null, exclusion: move.decision.exclusion, log: [], updatedAt: at }, { merge: true })
    }
    await doc.ref.update(move.offerPatch)
  }
  console.log(`\n${offers.length} offers · ${excluded} exclusions, ${asked} better-price requests, ${answered} answered cuts ${apply ? "moved" : "would move"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
