// Makes an existing account platform staff (role "Admin"): it then reads the admin portal and the
// admin CRM (firestore.rules isAdmin()). An account has ONE role, so the account leaves any company
// it was a team member of: its company becomes its own account, as the other admin accounts' is, and
// its team group is dropped. Nothing else on the account changes, and nothing is deleted from the
// company it leaves. Reversible: set `role` back and `organizationId` / `organizationRole` /
// `defaultGroupId` to what the dry run printed.
//
//   node scripts/make-admin.js uat  info@example.com           — DRY RUN: prints before and after
//   node scripts/make-admin.js uat  info@example.com --apply   — writes
//   node scripts/make-admin.js prod info@example.com           — dry run against production
//   node scripts/make-admin.js prod info@example.com --apply   — OWNER ONLY, after reading the dry run
//
// It never creates an account: the e-mail must already have a users document (exactly one).
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).
// For UAT only, with no key in the env file, the signed-in `gcloud` user is used instead.

const target = process.argv[2]
const email = (process.argv[3] || "").trim()
const apply = process.argv.includes("--apply")
if ((target !== "uat" && target !== "prod") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: node scripts/make-admin.js <uat|prod> <email> [--apply]")
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

const KEYS = ["role", "organizationId", "organizationRole", "defaultGroupId"]
const pick = (u) => Object.fromEntries(KEYS.map((k) => [k, u[k] === undefined ? "(not set)" : u[k]]))

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const snap = await db.collection("users").where("email", "==", email).get()
  if (snap.size !== 1) {
    console.error(`refusing: ${snap.size} users documents carry ${email} — need exactly one (this script never creates accounts)`)
    process.exit(1)
  }
  const ref = snap.docs[0].ref
  const user = snap.docs[0].data()
  console.log("account:", ref.id)
  console.log("before :", JSON.stringify(pick(user)))
  if (user.role === "Admin") {
    console.log("already an Admin — nothing to do")
    return
  }
  const after = { role: "Admin", organizationId: ref.id, organizationRole: "owner" }
  console.log("after  :", JSON.stringify({ ...after, defaultGroupId: "(removed)" }))
  if (user.organizationId && user.organizationId !== ref.id) console.log(`leaves company ${user.organizationId} (its other members and records are untouched)`)

  if (!apply) {
    console.log("\ndry run — re-run with --apply to write")
    return
  }
  await ref.update({ ...after, defaultGroupId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
  const check = (await ref.get()).data()
  console.log("\ndone — now:", JSON.stringify(pick(check)))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
