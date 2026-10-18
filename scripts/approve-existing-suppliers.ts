// Onboarding (owner, 18 Oct 2026): a supplier sends no quotation until the platform admin approves his company, and an
// approval needs the commercial registration AND the tax registration certificate. For the supplier companies that
// already exist, the owner's decision: approve the ones that already have both documents (or are already approved);
// the rest upload them and wait for the admin like any new supplier. Never un-approves anyone.
//
//   npx tsx scripts/approve-existing-suppliers.ts uat            — dry run: who would be approved, who still lacks what
//   npx tsx scripts/approve-existing-suppliers.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/approve-existing-suppliers.ts prod --apply   — OWNER ONLY, after reading the dry run
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { missingApprovalDocs } from "../src/lib/supplier-approval"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: approve-existing-suppliers.ts <uat|prod> [--apply] [--org <orgId> ...]")
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

type Rec = Record<string, unknown>

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const users = (await db.collection("users").where("role", "==", "Supplier").get()).docs
  const orgs = new Set<string>()
  for (const u of users) {
    const org = String((u.data() as { organizationId?: string }).organizationId || u.id)
    if (!only.length || only.includes(org)) orgs.add(org)
  }
  let approved = 0
  let already = 0
  let waiting = 0
  for (const org of orgs) {
    // The company's standing lives on the owner's users/{org} for a primary company, else on organizations/{org}.
    const [userSnap, orgSnap, identity] = await Promise.all([db.collection("users").doc(org).get(), db.collection("organizations").doc(org).get(), db.collection("companyIdentity").doc(org).get()])
    const ref = orgSnap.exists ? orgSnap.ref : userSnap.ref
    const company = ((orgSnap.exists ? orgSnap.data() : userSnap.data()) || {}) as Rec
    const name = String(company.companyName || company.name || org)
    if (company.isVerified === true) {
      already++
      console.log(`  keep      ${org} · ${name} · already approved`)
      continue
    }
    const docs = { ...(((identity.data() || {}) as Rec).legalDocuments as Rec | undefined), ...(company.legalDocuments as Rec | undefined) }
    const missing = missingApprovalDocs(docs)
    if (missing.length) {
      waiting++
      console.log(`  waits     ${org} · ${name} · missing ${missing.join(" + ")} — uploads and asks for approval`)
      continue
    }
    approved++
    console.log(`  ${apply ? "approve  " : "would approve"} ${org} · ${name} · has the CR and the tax certificate`)
    if (apply) await ref.set({ isVerified: true, verificationRequested: false, approvedBy: "approve-existing-suppliers", approvedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  console.log(`\n${orgs.size} supplier companies: ${already} already approved, ${approved} ${apply ? "approved" : "would be approved"}, ${waiting} must upload and wait for the admin`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
