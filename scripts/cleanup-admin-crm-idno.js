// Removes the national ID / iqama / passport number the admin CRM used to keep on a lead's or client's
// record (ADM-05 item 6, 6 Oct 2026): the field is gone from the screen, and what was typed into it is
// removed from the database too — it had no purpose beyond the platform's data-minimisation rule.
//
//   node scripts/cleanup-admin-crm-idno.js uat            — DRY RUN: counts the records that hold one
//   node scripts/cleanup-admin-crm-idno.js uat  --apply   — removes the field (nothing else on the record changes)
//   node scripts/cleanup-admin-crm-idno.js prod           — dry run against production
//   node scripts/cleanup-admin-crm-idno.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Only `adminCrmClients/{id}.idNo` is touched. The numbers themselves are never printed — ids only.
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/cleanup-admin-crm-idno.js <uat|prod> [--apply]")
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
  // UAT only, with no key in the env file: the signed-in gcloud user, as deploy-rules.js does.
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

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const snap = await db.collection("adminCrmClients").get()
  const holders = snap.docs.filter((d) => Object.prototype.hasOwnProperty.call(d.data(), "idNo"))
  for (const d of holders) console.log(`  adminCrmClients/${d.id} — holds an ID number → ${apply ? "remove" : "would remove"}`)
  console.log(`\n${snap.size} records read · ${holders.length} hold an ID number`)
  if (apply && holders.length) {
    for (let i = 0; i < holders.length; i += 400) {
      const batch = db.batch()
      holders.slice(i, i + 400).forEach((d) => batch.update(d.ref, { idNo: FieldValue.delete() }))
      await batch.commit()
    }
    console.log("done — the field is removed")
  } else if (!apply) {
    console.log("dry run — re-run with --apply to remove them")
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
