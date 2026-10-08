// Creates a NEW platform-staff account (role "Admin") — for someone who has no account yet. To promote an account
// that already exists, use scripts/make-admin.js instead; this one refuses an e-mail that is taken.
//
//   node scripts/create-admin.js uat  someone@mdmaktech.sa "Full Name"           — DRY RUN: checks, prints the plan
//   node scripts/create-admin.js uat  someone@mdmaktech.sa "Full Name" --apply   — creates it
//   node scripts/create-admin.js prod someone@mdmaktech.sa "Full Name" --apply   — OWNER ONLY, after the dry run
//
// What it writes, exactly as /api/admin/users/create shapes an account — but role "Admin": a Firebase Auth user with
// NO password (nobody ever sees or sets one) and its users/{uid} profile, its own organisation (organizationId = uid,
// owner), profileCompleted false so the admin profile page asks for the rest on first visit. Rolls the Auth user back
// if the profile cannot be written.
//
// It prints NO password and NO link. The new admin sets a password from the sign-in page: «Forgot password?» with
// this e-mail sends Firebase's reset e-mail, which works for an account that has no password yet.
//
// Credentials: the service account in `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY). Creating an Auth user needs the service account — there is no gcloud fallback here.

const target = process.argv[2]
const email = (process.argv[3] || "").trim().toLowerCase()
const name = (process.argv[4] || "").trim()
const apply = process.argv.includes("--apply")
if ((target !== "uat" && target !== "prod") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2 || name.startsWith("--")) {
  console.error('usage: node scripts/create-admin.js <uat|prod> <email> "<full name>" [--apply]')
  process.exit(1)
}
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const projectId = process.env.FIREBASE_PROJECT_ID
if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL || !projectId) {
  console.error(`refusing: ${target === "uat" ? ".env.uat" : ".env.local"} needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY`)
  process.exit(1)
}
if (target === "uat" && projectId !== "mdmaktech-uat") {
  console.error(`refusing: asked for uat but the credentials are for "${projectId}"`)
  process.exit(1)
}
if (target === "prod" && projectId === "mdmaktech-uat") {
  console.error("refusing: asked for prod but the credentials are for UAT")
  process.exit(1)
}

const { initializeApp, cert } = require("firebase-admin/app")
const { getAuth } = require("firebase-admin/auth")
const { getFirestore, FieldValue } = require("firebase-admin/firestore")
initializeApp({
  credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }),
  projectId,
})
const auth = getAuth()
const db = getFirestore()

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)

  // The e-mail must be free in BOTH places: an Auth user without a profile (or the reverse) is a half account.
  const existing = await auth.getUserByEmail(email).catch((e) => (e && e.code === "auth/user-not-found" ? null : Promise.reject(e)))
  if (existing) {
    console.error(`refusing: ${email} already has a sign-in account (${existing.uid}). To make it an admin: node scripts/make-admin.js ${target} ${email}`)
    process.exit(1)
  }
  const profiles = await db.collection("users").where("email", "==", email).get()
  if (!profiles.empty) {
    console.error(`refusing: ${profiles.size} users document(s) already carry ${email} — fix those first`)
    process.exit(1)
  }

  console.log("will create:")
  console.log(`  sign-in account  ${email} · "${name}" · no password (set it via «Forgot password?» on the sign-in page)`)
  console.log('  profile          users/<new uid> · role "Admin" · its own organisation (owner) · profileCompleted false')
  if (!apply) {
    console.log("\ndry run — re-run with --apply to create")
    return
  }

  const user = await auth.createUser({ email, displayName: name, emailVerified: false })
  try {
    await db.collection("users").doc(user.uid).set({
      id: user.uid,
      name,
      email,
      phone: "",
      role: "Admin",
      organizationId: user.uid,
      organizationRole: "owner",
      specializations: [],
      providers: ["password"],
      isVerified: true,
      profileCompleted: false,
      createdByScript: "create-admin",
      joinedAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await auth.deleteUser(user.uid).catch(() => {})
    console.error("could not write the profile — the sign-in account was removed again:", err.message || err)
    process.exit(1)
  }
  const check = (await db.collection("users").doc(user.uid).get()).data()
  console.log(`\ndone — ${user.uid} · role ${check.role}`)
  console.log(`next: on the sign-in page, «Forgot password?» with ${email}, set a password, sign in, open /admin/crm`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
