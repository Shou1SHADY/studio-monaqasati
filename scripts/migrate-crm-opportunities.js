// ADM-07 (Admin CRM changes v1.1, 6 Oct 2026): the opportunity is part of the lead. The admin CRM no longer
// shows an opportunities section, so what staff registered there must live on the lead's own record:
// plan, expected value and expected close. This copies each OPEN opportunity (adminCrmDeals, kind
// "opportunity") onto the record it belongs to (adminCrmClients/{clientId}).
//
//   node scripts/migrate-crm-opportunities.js uat            — DRY RUN: what would move, counts and ids only
//   node scripts/migrate-crm-opportunities.js uat  --apply   — writes
//   node scripts/migrate-crm-opportunities.js prod           — dry run against production
//   node scripts/migrate-crm-opportunities.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Rules, so it is safe to run twice and never overwrites what staff typed on the lead:
//   - only a field the record does NOT already hold is filled (expectedValue, plan, expectedClose);
//   - of several open opportunities on one record the latest dated one is used;
//   - won and lost opportunities stay where they are (history) and are only counted;
//   - nothing is deleted — the opportunity documents are left in adminCrmDeals.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).
// For UAT only, with no key in the env file, the signed-in `gcloud` user is used (as deploy-rules.js does);
// production always needs its service account.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-crm-opportunities.js <uat|prod> [--apply]")
  process.exit(1)
}
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const { initializeApp, cert } = require("firebase-admin/app")
let { getFirestore, FieldValue } = require("firebase-admin/firestore")

let projectId = process.env.FIREBASE_PROJECT_ID
let credential
let db
if (process.env.FIREBASE_PRIVATE_KEY) {
  credential = cert({
    projectId,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  })
} else if (target === "uat") {
  const { execSync } = require("child_process")
  const { Firestore, FieldValue: GcpFieldValue } = require("@google-cloud/firestore")
  FieldValue = GcpFieldValue
  const { OAuth2Client } = require("google-auth-library")
  const authClient = new OAuth2Client()
  authClient.setCredentials({ access_token: execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim() })
  projectId = "mdmaktech-uat"
  credential = true
  db = new Firestore({ projectId, authClient })
  console.log("no service-account key for uat — using the signed-in gcloud user")
}
if (target === "uat" && projectId !== "mdmaktech-uat") {
  console.error(`refusing: asked for uat but the credentials are for "${projectId}"`)
  process.exit(1)
}
if (target === "prod" && (!credential || projectId === "mdmaktech-uat")) {
  console.error(projectId === "mdmaktech-uat" ? "refusing: asked for prod but the credentials are for UAT" : "refusing: production needs its service account in .env.local")
  process.exit(1)
}
if (!db) {
  initializeApp({ credential, projectId })
  db = getFirestore()
}

// Keep in step with CLIENT_PLANS in src/lib/admin-crm.ts.
const PLANS = ["trial", "starter", "growth", "enterprise"]

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const deals = (await db.collection("adminCrmDeals").get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.kind === "opportunity")
  const byRecord = new Map()
  for (const d of deals) {
    if (!d.clientId) continue
    if (!byRecord.has(d.clientId)) byRecord.set(d.clientId, [])
    byRecord.get(d.clientId).push(d)
  }
  const closed = deals.filter((d) => d.state !== "open").length
  console.log(`${deals.length} opportunities read · ${deals.length - closed} open · ${closed} won or lost (left as history)`)

  let changed = 0
  let untouched = 0
  const writes = []
  for (const [clientId, list] of byRecord) {
    const open = list.filter((d) => d.state === "open").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    if (!open.length) continue
    const pick = open[0]
    const ref = db.collection("adminCrmClients").doc(clientId)
    const snap = await ref.get()
    const rec = snap.exists ? snap.data() : {}
    const patch = {}
    if (!(typeof rec.expectedValue === "number" && rec.expectedValue > 0) && typeof pick.amount === "number" && pick.amount > 0) patch.expectedValue = pick.amount
    if (!rec.plan && PLANS.includes(pick.plan)) patch.plan = pick.plan
    if (!rec.expectedClose && /^\d{4}-\d{2}-\d{2}$/.test(pick.date || "")) patch.expectedClose = pick.date
    if (!Object.keys(patch).length) {
      untouched++
      continue
    }
    changed++
    console.log(`  adminCrmClients/${clientId} ← ${Object.keys(patch).join(", ")}  (from deal ${pick.id}${open.length > 1 ? `, latest of ${open.length} open` : ""})`)
    writes.push({ ref, patch })
  }
  console.log(`\n${changed} records would be filled · ${untouched} already hold their own values`)

  if (apply && writes.length) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch()
      writes.slice(i, i + 400).forEach(({ ref, patch }) => batch.set(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true }))
      await batch.commit()
    }
    console.log("done")
  } else if (!apply) {
    console.log("dry run — re-run with --apply to write")
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
