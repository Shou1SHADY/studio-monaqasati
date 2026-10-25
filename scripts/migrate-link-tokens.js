// Link tokens are stored as a SHA-256 hash from now on (src/lib/links). Links issued before that hold their
// token as plaintext in a `token` field of rfqShareLinks / guestOfferLinks / pmPortalLinks (the PM consultant
// portal, hashed since PM 1.1 — kind "pm"). This gives each of them its hash:
//
//   linkTokens/{sha256(token)}  →  { kind, linkId }      (the lookup index)
//   <link>.tokenHashes          →  [..., sha256(token)]
//
// The link keeps resolving exactly as before — by hash now, and by the plaintext field too while it is still
// there. The plaintext is removed only with --strip, once the hashed lookup has been seen to work.
//
//   node scripts/migrate-link-tokens.js uat                   — DRY RUN: lists what it would change
//   node scripts/migrate-link-tokens.js uat  --apply          — writes the hashes, keeps the plaintext
//   node scripts/migrate-link-tokens.js uat  --apply --strip  — also deletes the plaintext `token`
//   node scripts/migrate-link-tokens.js prod                  — dry run against production
//   node scripts/migrate-link-tokens.js prod --apply          — OWNER ONLY, after reading the dry run
//   node scripts/migrate-link-tokens.js uat --only pmPortalLinks  — one collection (dry run unless --apply)
//
// Idempotent: a link whose hash is already listed is skipped, and a link with no plaintext token is left alone.
// Expiry is never touched. receiptLinks are a later pass (src/lib/receipt-links.ts still reads its own plaintext).
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).

const { createHash } = require("crypto")

const target = process.argv[2]
const apply = process.argv.includes("--apply")
const strip = process.argv.includes("--strip")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-link-tokens.js <uat|prod> [--apply] [--strip]")
  process.exit(1)
}
if (strip && !apply) {
  console.error("--strip needs --apply")
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
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\n/g, "\n"),
  }),
})
const db = getFirestore()

const ALL_COLLECTIONS = [
  { name: "rfqShareLinks", kind: "rfq" },
  { name: "guestOfferLinks", kind: "offer" },
  { name: "pmPortalLinks", kind: "pm" },
]
const onlyAt = process.argv.indexOf("--only")
const only = onlyAt > 0 ? process.argv[onlyAt + 1] : null
const COLLECTIONS = only ? ALL_COLLECTIONS.filter((c) => c.name === only) : ALL_COLLECTIONS
if (only && !COLLECTIONS.length) {
  console.error(`--only: unknown collection "${only}" (${ALL_COLLECTIONS.map((c) => c.name).join(", ")})`)
  process.exit(1)
}
const INDEX = "linkTokens"
const hashToken = (token) => createHash("sha256").update(token).digest("hex")

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? (strip ? "APPLYING + STRIPPING plaintext" : "APPLYING (plaintext kept)") : "dry run — nothing will be written"}\n`)
  const plan = []
  let read = 0
  for (const c of COLLECTIONS) {
    const snap = await db.collection(c.name).get()
    read += snap.size
    for (const d of snap.docs) {
      const data = d.data()
      const token = typeof data.token === "string" ? data.token : ""
      if (!token) continue
      const hash = hashToken(token)
      const hashes = Array.isArray(data.tokenHashes) ? data.tokenHashes : []
      const needsHash = !hashes.includes(hash)
      if (!needsHash && !strip) continue
      plan.push({ ref: d.ref, id: d.id, collection: c.name, kind: c.kind, hash, needsHash, hashes })
    }
  }
  if (!plan.length) {
    console.log(`${read} links read — nothing to change.`)
    return
  }
  for (const p of plan) console.log(`  ${p.collection}/${p.id}  ${p.needsHash ? "+ hash" : "hash present"}${strip ? "  − plaintext token" : ""}`)
  console.log(`\n${plan.length} of ${read} links would change.`)
  if (!apply) {
    console.log("Re-run with --apply to write.")
    return
  }
  let batch = db.batch()
  let n = 0
  let done = 0
  const flush = async () => {
    if (n) await batch.commit()
    batch = db.batch()
    n = 0
  }
  for (const p of plan) {
    if (p.needsHash) {
      batch.set(db.collection(INDEX).doc(p.hash), { kind: p.kind, linkId: p.id, createdAt: new Date().toISOString(), migrated: true })
      n++
    }
    const patch = {}
    if (p.needsHash) patch.tokenHashes = [...p.hashes, p.hash]
    if (strip) patch.token = FieldValue.delete()
    batch.update(p.ref, patch)
    n++
    done++
    if (n >= 400) await flush()
  }
  await flush()
  console.log(`Done: ${done} links updated.`)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
