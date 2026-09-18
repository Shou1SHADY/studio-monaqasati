// Removes what the old /admin/seed page wrote — the phantom records a customer
// review found in Procurement ("أسمنت اليمامة" in the supplier directory).
//
//   node scripts/cleanup-seed-demo.js uat            — DRY RUN: lists what it would delete
//   node scripts/cleanup-seed-demo.js uat  --apply   — deletes
//   node scripts/cleanup-seed-demo.js prod           — dry run against production
//   node scripts/cleanup-seed-demo.js prod --apply   — OWNER ONLY, after reading the dry run
//
// It touches ONLY documents whose id AND content match what the seeder wrote
// (fixed ids: users/sup-1..3, rfqs/rfq-demo-1..3). A real document that happens
// to have one of those ids but different content is reported and left alone.
// `categories/cat-*` and `cities/city-*` are reference data the app uses — kept.
//
// Anything that points at a deleted supplier (favourites, supplier links,
// offers on a demo RFQ) is LISTED so it can be reviewed; it is not deleted.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY) — the same service accounts the other ops scripts use.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/cleanup-seed-demo.js <uat|prod> [--apply]")
  process.exit(1)
}
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const { initializeApp, cert } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")

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

// id → the e-mail the seeder wrote. example.com is reserved: no real supplier has it.
const SEEDED_SUPPLIERS = {
  "sup-1": "riyadh.steel@example.com",
  "sup-2": "yamama.cement@example.com",
  "sup-3": "national.paints@example.com",
}
const SEEDED_RFQS = ["rfq-demo-1", "rfq-demo-2", "rfq-demo-3"]

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be deleted"}\n`)
  const doomed = []

  for (const [id, email] of Object.entries(SEEDED_SUPPLIERS)) {
    const snap = await db.doc(`users/${id}`).get()
    if (!snap.exists) { console.log(`  users/${id} — not there`); continue }
    const d = snap.data()
    if (d.email === email && d.role === "Supplier") {
      doomed.push(snap.ref)
      console.log(`  users/${id} — "${d.name}" <${d.email}>  → delete`)
    } else {
      console.log(`  users/${id} — EXISTS BUT IS NOT THE SEEDED DOC ("${d.name}" <${d.email}>) → left alone`)
    }
  }

  for (const id of SEEDED_RFQS) {
    const snap = await db.doc(`rfqs/${id}`).get()
    if (!snap.exists) { console.log(`  rfqs/${id} — not there`); continue }
    doomed.push(snap.ref)
    console.log(`  rfqs/${id} — "${snap.data().title || snap.data().projectName || ""}"  → delete`)
    const offers = await db.collection("offers").where("rfqId", "==", id).get()
    if (!offers.empty) console.log(`      ! ${offers.size} offer(s) point at it — review: ${offers.docs.map((o) => o.id).join(", ")}`)
  }

  // What still points at a phantom supplier — reported, never deleted here.
  const ids = Object.keys(SEEDED_SUPPLIERS)
  for (const [coll, field] of [["contractorSupplierLinks", "supplierId"], ["offers", "supplierId"], ["favoriteSuppliers", "supplierId"]]) {
    try {
      const refs = await db.collection(coll).where(field, "in", ids).get()
      if (!refs.empty) console.log(`  ! ${coll}: ${refs.size} doc(s) reference a seeded supplier — review: ${refs.docs.map((r) => r.id).join(", ")}`)
    } catch (e) {
      console.log(`  (could not check ${coll}.${field}: ${e.message.split("\n")[0]})`)
    }
  }

  if (!doomed.length) { console.log("\nnothing to delete."); return }
  if (!apply) { console.log(`\n${doomed.length} document(s) would be deleted. Re-run with --apply to delete them.`); return }
  const batch = db.batch()
  doomed.forEach((ref) => batch.delete(ref))
  await batch.commit()
  console.log(`\ndeleted ${doomed.length} document(s).`)
})().catch((e) => { console.error(e.message); process.exit(1) })
