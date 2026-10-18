// Creates free supplier accounts from the review-day kit's filled supplier-profile.csv (Delivery-Supplier-1.0
// R1-start/supplier-profile-template.csv), so the suppliers who attend sign in with their own mobile and a code and
// find their company already there. Each row becomes what the mobile sign-in makes (newSupplierUser) plus the file's
// identity: name in Arabic and English, CR, VAT number, city, national address, e-mail, specialties and coverage —
// with the CR, VAT number and IBAN also in companyIdentity (DEV-60). No plan document, so the company is FREE; not
// approved: it uploads the CR and the tax certificate and the admin approves it (onboarding). A mobile that already has
// an account is never touched — reported, skipped.
//
//   npx tsx scripts/import-r1-suppliers.ts uat  <supplier-profile.csv> [--specialties <specialties.csv>]   — dry run
//   npx tsx scripts/import-r1-suppliers.ts prod <supplier-profile.csv> …                                  — dry run, production
//   … --apply                                                                     — OWNER ONLY, after reading the dry run

import { readFileSync } from "fs"
import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { readR1Suppliers, specialtyCodes } from "../src/lib/supplier-free/r1-import"
import { newSupplierUser } from "../src/lib/supplier-free/phone-auth"

const argv = process.argv.slice(2)
const target = argv[0]
const file = argv[1]
if ((target !== "uat" && target !== "prod") || !file || file.startsWith("--")) throw new Error("usage: import-r1-suppliers.ts <uat|prod> <supplier-profile.csv> [--specialties <csv>] [--apply]")
const apply = argv.includes("--apply")
const specFile = argv.includes("--specialties") ? argv[argv.indexOf("--specialties") + 1] : null
config({ path: resolve(process.cwd(), target === "uat" ? ".env.uat" : ".env.local") })

function connect(): { db: Firestore; projectId: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!process.env.FIREBASE_PRIVATE_KEY) throw new Error(`${target}: no service account in ${target === "uat" ? ".env.uat" : ".env.local"}`)
  if (target === "uat" && projectId !== "mdmaktech-uat") throw new Error(`refusing: .env.uat points at ${projectId}`)
  if (target === "prod" && projectId === "mdmaktech-uat") throw new Error("refusing: .env.local points at UAT")
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY as string).replace(/\\n/g, "\n") }), projectId })
  return { db: getFirestore(), projectId: projectId as string }
}

async function main() {
  const { db, projectId } = connect()
  const auth = getAuth()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"} · ${file}\n`)
  const rows = readR1Suppliers(readFileSync(file, "utf8"), specialtyCodes(specFile ? readFileSync(specFile, "utf8") : null))
  let created = 0
  let skipped = 0
  let refused = 0
  for (const r of rows) {
    if (!r.ok) {
      refused++
      console.log(`  refused   line ${r.line} · ${r.problems.join(", ")}${r.detail.length ? ` (${r.detail.join(", ")})` : ""}`)
      continue
    }
    const s = r.supplier
    const existing = await auth.getUserByPhoneNumber(s.phone).catch(() => null)
    if (existing) {
      skipped++
      console.log(`  skip      line ${r.line} · ${s.nameAr} · ${s.phone} already has an account (${existing.uid}) — left as it is`)
      continue
    }
    created++
    console.log(`  ${apply ? "create   " : "would create"} line ${r.line} · ${s.nameAr} · ${s.phone} · ${s.specializations.join("، ")}`)
    if (!apply) continue
    const uid = (await auth.createUser({ phoneNumber: s.phone, displayName: s.nameAr })).uid
    const identity = { crNumber: s.crNumber, taxNumber: s.vatNumber }
    await db
      .collection("users")
      .doc(uid)
      .set({
        ...newSupplierUser(uid, s.phone, { name: s.nameAr, company: s.nameAr }),
        ...identity,
        name: s.nameAr,
        companyNameEn: s.nameEn,
        email: s.email,
        city: s.city,
        nationalAddress: s.nationalAddress,
        location: s.nationalAddress,
        specializations: s.specializations,
        coverageCities: s.coverageCities,
        importedFrom: "r1-supplier-profile",
        joinedAt: FieldValue.serverTimestamp(),
      })
    await db.collection("companyIdentity").doc(uid).set({ ...identity, ...(s.iban ? { iban: s.iban } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await db.collection("companyPublicFacts").doc(uid).set({ hasVat: s.vatNumber !== "", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  console.log(`\n${rows.length} rows: ${created} ${apply ? "created" : "would be created"}, ${skipped} skipped (mobile already has an account), ${refused} refused`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
