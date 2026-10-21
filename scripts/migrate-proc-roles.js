// Procurement 2.0 (PRD §3–§4) — the four roles under the owner. SEEDED_GROUPS in src/lib/permissions.ts now carries
// `procurement_manager`, `procurement_officer`, `supply_follower` and `material_requester`; seeded groups are written once per
// organisation, so a company that already has its groups never gets them from the app. This script:
//
//   + creates the four groups (at their deterministic ids `${organizationId}_${key}`, never overwriting a document that exists)
//     for every company whose groups were seeded — it has its `finance` or `viewer` group — and never for one the owner built by hand;
//   ? LISTS, never changes, the members of the seeded `supply_chain` group: it holds `offers.view`, so its members see prices, and
//     the 2.0 expediter does not. Move them to `supply_follower` from the team page when that is what the owner means.
//
//   node scripts/migrate-proc-roles.js uat            — DRY RUN: lists what it would create and who it found
//   node scripts/migrate-proc-roles.js uat  --apply   — writes
//   node scripts/migrate-proc-roles.js prod           — dry run against production
//   node scripts/migrate-proc-roles.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Idempotent: a group that exists is skipped. Nothing is ever removed or edited.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).

/** = the Procurement entries of SEEDED_GROUPS in src/lib/permissions.ts (proc-roles-matrix.test.ts keeps them equal). */
const PROC_SEEDED_GROUPS = [
  { key: "procurement_manager", name: "مدير المشتريات", permissions: ["projects.view", "rfq.create", "rfq.manage", "offers.view", "offers.accept", "po.approve", "po.expedite", "suppliers.manage"] },
  { key: "procurement_officer", name: "مسؤول المشتريات", permissions: ["projects.view", "rfq.create", "rfq.manage", "offers.view", "offers.accept", "po.expedite", "suppliers.manage"] },
  { key: "supply_follower", name: "متابع التوريد", permissions: ["projects.view", "po.expedite"] },
  { key: "material_requester", name: "طالب مواد", permissions: ["projects.view"] },
]

/**
 * The plan, pure. `groups`: [{ id, organizationId, key, name, permissions }]; `membersByGroup`: groupId → [{ id, name, email }]
 * (users whose DEFAULT group it is).
 */
function planFor({ groups, membersByGroup }) {
  const byOrg = new Map()
  for (const g of groups) {
    const list = byOrg.get(g.organizationId) || []
    list.push(g)
    byOrg.set(g.organizationId, list)
  }
  const create = []
  const seePrices = []
  for (const [org, list] of byOrg) {
    if (!list.some((g) => g.id === `${org}_finance` || g.id === `${org}_viewer`)) continue
    for (const s of PROC_SEEDED_GROUPS) if (!list.some((g) => g.id === `${org}_${s.key}`)) create.push({ id: `${org}_${s.key}`, organizationId: org, ...s })
    const chain = list.find((g) => g.id === `${org}_supply_chain`)
    if (chain && Array.isArray(chain.permissions) && chain.permissions.includes("offers.view")) {
      const members = membersByGroup.get(chain.id) || []
      if (members.length) seePrices.push({ group: chain.id, organizationId: org, members })
    }
  }
  return { create, seePrices }
}

module.exports = { PROC_SEEDED_GROUPS, planFor }

async function main() {
  const target = process.argv[2]
  const apply = process.argv.includes("--apply")
  if (target !== "uat" && target !== "prod") {
    console.error("usage: node scripts/migrate-proc-roles.js <uat|prod> [--apply]")
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
    credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }),
  })
  const db = getFirestore()

  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}\n`)
  const groups = (await db.collection("teamGroups").get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const membersByGroup = new Map()
  const userSnap = await db.collection("users").select("defaultGroupId", "name", "email").get()
  for (const u of userSnap.docs) {
    const gid = u.get("defaultGroupId")
    if (typeof gid !== "string" || !gid) continue
    const list = membersByGroup.get(gid) || []
    list.push({ id: u.id, name: u.get("name") || "", email: u.get("email") || "" })
    membersByGroup.set(gid, list)
  }
  const plan = planFor({ groups, membersByGroup })

  console.log(`${groups.length} groups, ${userSnap.size} users read.\n`)
  console.log(`+ Procurement groups to create (${plan.create.length}):`)
  for (const g of plan.create) console.log(`  ${g.id}  (${g.name}, org ${g.organizationId}) [${g.permissions.join(", ")}]`)
  console.log(`\n? supply_chain members who see prices through offers.view (${plan.seePrices.length} group(s)) — left as they are:`)
  for (const g of plan.seePrices) for (const m of g.members) console.log(`  ${g.group}  ${m.name || m.id} <${m.email}>`)

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.")
    return
  }
  let batch = db.batch()
  let n = 0
  for (const g of plan.create) {
    // create(), not set(): a document that appeared since the read is never overwritten (the batch fails instead).
    batch.create(db.collection("teamGroups").doc(g.id), { organizationId: g.organizationId, key: g.key, name: g.name, permissions: g.permissions, isSystem: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    if (++n % 400 === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  await batch.commit()
  console.log(`\nDone: ${plan.create.length} group(s) created.`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
