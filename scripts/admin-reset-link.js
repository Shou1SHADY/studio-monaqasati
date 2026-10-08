// Prints a one-time «set your password» link for a platform-staff (role "Admin") account — for when Firebase's reset
// e-mail does not arrive (company mail often quarantines noreply@<project>.firebaseapp.com). Admin accounts only:
// it refuses any other role, so it cannot be used to take over a customer's account.
//
//   node scripts/admin-reset-link.js uat  someone@mdmaktech.sa
//   node scripts/admin-reset-link.js prod someone@mdmaktech.sa
//
// Run it YOURSELF and open the link in your own browser: anyone holding the link can set the password until it
// expires or is used. Never paste it into chat, a ticket or a log.
//
// Credentials: the service account in `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY).

const target = process.argv[2]
const email = (process.argv[3] || "").trim().toLowerCase()
if ((target !== "uat" && target !== "prod") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: node scripts/admin-reset-link.js <uat|prod> <email>")
  process.exit(1)
}
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const projectId = process.env.FIREBASE_PROJECT_ID
if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL || !projectId) {
  console.error(`refusing: ${target === "uat" ? ".env.uat" : ".env.local"} needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY`)
  process.exit(1)
}
if ((target === "uat") !== (projectId === "mdmaktech-uat")) {
  console.error(`refusing: asked for ${target} but the credentials are for "${projectId}"`)
  process.exit(1)
}

const { initializeApp, cert } = require("firebase-admin/app")
const { getAuth } = require("firebase-admin/auth")
const { getFirestore } = require("firebase-admin/firestore")
initializeApp({
  credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }),
  projectId,
})

;(async () => {
  const user = await getAuth().getUserByEmail(email).catch(() => null)
  if (!user) {
    console.error(`refusing: ${email} has no sign-in account on ${target}`)
    process.exit(1)
  }
  const profile = (await getFirestore().collection("users").doc(user.uid).get()).data()
  if (profile?.role !== "Admin") {
    console.error(`refusing: ${email} is not an Admin account on ${target} — this script is for platform staff only`)
    process.exit(1)
  }
  const link = await getAuth().generatePasswordResetLink(email)
  console.log(`${target.toUpperCase()} · ${email} — open this link in your browser to set the password (one use, expires):\n`)
  console.log(link)
})().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
