// Grants the two purchase-order permissions (Procurement PRD 3.0) to the team
// groups that already hold their older cousins — seeded groups are written once
// per org, so a change to SEEDED_GROUPS in src/lib/permissions.ts never reaches
// an existing organisation's `teamGroups` documents.
//
//   `po.approve`  → every group holding `offers.accept` (it awards, so it approves)
//   `po.expedite` → every group holding `rfq.manage`   (it runs the RFQ, so it chases the supplier)
//
// A group holding '*' needs nothing; owners need nothing (they pass every check).
//
//   node scripts/migrate-po-permissions.js uat            — DRY RUN: lists what it would change
//   node scripts/migrate-po-permissions.js uat  --apply   — writes
//   node scripts/migrate-po-permissions.js prod           — dry run against production
//   node scripts/migrate-po-permissions.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Idempotent: a group that already holds a permission is skipped. Nothing is
// ever removed.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY) — the same service accounts the other ops scripts use.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-po-permissions.js <uat|prod> [--apply]")
  process.exit(1)
}
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const { initializeApp, cert } = require("firebase-admin/app")
const { getFirestore, FieldValue } = require("firebase-admin/firestore")

const projectId = process.env.FIREBASE_PROJECT_ID
if (target === "uat" && projectId !== "mdmaktech-uat") {
  console.error(`refusing: asked for uat but the credentials are for "${projectId}"`)
  process.exit(1)
}
if (target === "prod" && projectId === "mdmaktech-uat") {
  console.error("refusing: asked for prod but the credentials are for UAT")
  process.exit(1)
}

initializeApp({
  credential: cert({
    projectId,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
})
const db = getFirestore()

// granted permission → the existing permission that earns it
const GRANTS = [
  { grant: "po.approve", when: "offers.accept" },
  { grant: "po.expedite", when: "rfq.manage" },
]

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}\n`)
  const snap = await db.collection("teamGroups").get()
  const plan = []
  for (const d of snap.docs) {
    const data = d.data()
    const perms = Array.isArray(data.permissions) ? data.permissions : []
    if (perms.includes("*")) continue
    const add = GRANTS.filter((g) => perms.includes(g.when) && !perms.includes(g.grant)).map((g) => g.grant)
    if (add.length) plan.push({ id: d.id, org: data.organizationId || "?", name: data.name || data.key || "?", add })
  }
  if (!plan.length) {
    console.log(`${snap.size} groups read — nothing to change.`)
    return
  }
  for (const p of plan) console.log(`  ${p.id}  (${p.name}, org ${p.org})  + ${p.add.join(", ")}`)
  console.log(`\n${plan.length} of ${snap.size} groups would change.`)
  if (!apply) {
    console.log("Re-run with --apply to write.")
    return
  }
  let batch = db.batch()
  let n = 0
  for (const p of plan) {
    batch.update(db.collection("teamGroups").doc(p.id), { permissions: FieldValue.arrayUnion(...p.add), updatedAt: FieldValue.serverTimestamp() })
    if (++n % 400 === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  await batch.commit()
  console.log(`\nDone: ${plan.length} groups updated.`)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
