// Grants the Project Management 1.0 system role (PRD §3) to the team groups that
// already manage projects — seeded groups are written once per org, so the new
// permission ids in src/lib/permissions.ts never reach an existing
// organisation's `teamGroups` documents on their own.
//
//   `pm.manage` → every group holding `projects.edit` (it runs projects today)
//
// `pm.cost` (QS & cost control) and `pm.site` (site engineer) are NOT inferred:
// nothing in the old catalogue says who is a quantity surveyor or a site
// engineer. The owner ticks them in Team → groups.
//
// Without a pm.* id a member holds no duty on a PM 1.0 project (one born from a
// handover file) unless their group is '*' — legacy projects are unaffected.
//
//   node scripts/migrate-pm-permissions.js uat            — DRY RUN: lists what it would change
//   node scripts/migrate-pm-permissions.js uat  --apply   — writes
//   node scripts/migrate-pm-permissions.js prod           — dry run against production
//   node scripts/migrate-pm-permissions.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Idempotent: a group that already holds a permission is skipped. Nothing is
// ever removed.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY) — the same service accounts the other ops scripts use.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-pm-permissions.js <uat|prod> [--apply]")
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

// granted permission → the existing permission that earns it
const GRANTS = [{ grant: "pm.manage", when: "projects.edit" }]

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}\n`)
  const snap = await db.collection("teamGroups").get()
  const plan = []
  for (const d of snap.docs) {
    const data = d.data()
    const perms = Array.isArray(data.permissions) ? data.permissions : []
    if (perms.includes("*")) continue
    const add = GRANTS.filter((g) => perms.includes(g.when) && !perms.includes(g.grant)).map((g) => g.grant)
    if (add.length) plan.push({ id: d.id, org: data.organizationId || "?", name: data.name || data.key || "?", add })
  }
  if (!plan.length) {
    console.log(`${snap.size} groups read — nothing to change.`)
    return
  }
  for (const p of plan) console.log(`  ${p.id}  (${p.name}, org ${p.org})  + ${p.add.join(", ")}`)
  console.log(`\n${plan.length} of ${snap.size} groups would change.`)
  if (!apply) {
    console.log("Re-run with --apply to write.")
    return
  }
  let batch = db.batch()
  let n = 0
  for (const p of plan) {
    batch.update(db.collection("teamGroups").doc(p.id), { permissions: FieldValue.arrayUnion(...p.add), updatedAt: FieldValue.serverTimestamp() })
    if (++n % 400 === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  await batch.commit()
  console.log(`\nDone: ${plan.length} groups updated.`)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
