// Copies each company's sensitive identity (CR number, tax number, certificate
// files, bank details) from its profile document into companyIdentity/{orgId}
// (DEV-60). The old fields are NOT removed here: older mobile app versions still
// read them, so stripping is a separate, later step.
//
//   node scripts/migrate-company-identity.js uat            — DRY RUN: counts and field names, never values
//   node scripts/migrate-company-identity.js uat  --apply   — writes
//   node scripts/migrate-company-identity.js prod           — dry run against production
//   node scripts/migrate-company-identity.js prod --apply   — OWNER ONLY, after reading the dry run and exporting Firestore
//
// Sources: users/{uid} for a primary company (the owner's own account — a team member's
// document carries no identity), organizations/{id} for a secondary company.
//
// Idempotent and non-destructive: a field the identity document already holds is left as it
// is (a differing old value is reported as a conflict, never overwritten); nothing is deleted.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY) — the same service accounts the other ops scripts use.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-company-identity.js <uat|prod> [--apply]")
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

// Keep in step with SENSITIVE_IDENTITY_KEYS in src/lib/company-identity.ts.
const KEYS = ["crNumber", "taxNumber", "legalDocuments", "iban", "bankName"]

const present = (v) => {
  if (v == null) return false
  if (typeof v === "string") return v.trim() !== ""
  if (typeof v === "object") return Object.keys(v).length > 0
  return true
}
const pick = (src) => {
  const out = {}
  for (const k of KEYS) if (present(src[k])) out[k] = typeof src[k] === "number" ? String(src[k]) : src[k]
  return out
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}\n`)

  const companies = []
  const users = await db.collection("users").get()
  for (const d of users.docs) {
    const u = d.data()
    const isOwner = !("organizationRole" in u) || u.organizationRole === "owner"
    if (!isOwner || (u.organizationId && u.organizationId !== d.id)) continue
    if (u.role !== "Contractor" && u.role !== "Supplier") continue
    companies.push({ orgId: d.id, kind: "primary", source: "users", data: u })
  }
  const orgs = await db.collection("organizations").get()
  for (const d of orgs.docs) companies.push({ orgId: d.id, kind: "secondary", source: "organizations", data: d.data() })

  const existing = new Map()
  for (const c of companies) {
    const snap = await db.collection("companyIdentity").doc(c.orgId).get()
    if (snap.exists) existing.set(c.orgId, snap.data())
  }

  let toCreate = 0
  let toFill = 0
  let upToDate = 0
  let empty = 0
  let conflicts = 0
  const writes = []
  for (const c of companies) {
    const wanted = pick(c.data)
    if (!Object.keys(wanted).length) {
      empty++
      continue
    }
    const have = existing.get(c.orgId)
    if (!have) {
      toCreate++
      writes.push({ orgId: c.orgId, patch: wanted, note: `create (${Object.keys(wanted).join(", ")})` })
      continue
    }
    const patch = {}
    const clash = []
    for (const [k, v] of Object.entries(wanted)) {
      if (!present(have[k])) patch[k] = v
      else if (!same(have[k], v)) clash.push(k)
    }
    if (clash.length) {
      conflicts++
      console.log(`  conflict ${c.kind} ${c.orgId}: ${clash.join(", ")} differ — identity document kept`)
    }
    if (Object.keys(patch).length) {
      toFill++
      writes.push({ orgId: c.orgId, patch, note: `fill (${Object.keys(patch).join(", ")})` })
    } else {
      upToDate++
    }
  }

  console.log(`companies read: ${companies.length} (${companies.filter((c) => c.kind === "primary").length} primary, ${companies.filter((c) => c.kind === "secondary").length} secondary)`)
  console.log(`  to create: ${toCreate} · to fill: ${toFill} · already up to date: ${upToDate} · nothing sensitive on file: ${empty} · conflicts: ${conflicts}`)
  for (const w of writes.slice(0, 15)) console.log(`  ${w.orgId}: ${w.note}`)
  if (writes.length > 15) console.log(`  … and ${writes.length - 15} more`)

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.")
    return
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const w of writes.slice(i, i + 400)) {
      batch.set(db.collection("companyIdentity").doc(w.orgId), { ...w.patch, migratedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    await batch.commit()
  }
  console.log(`\nWrote ${writes.length} identity documents.`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
