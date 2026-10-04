// HR 1.0 (PRD RL-01, docs/hr-prd-status.md §3 #17) — the seeded `finance` group held `employees.manage`,
// so every Finance member was the company's HR manager as well. SEEDED_GROUPS no longer gives it; seeded
// groups are written once per organisation, so this script takes it back from the groups that got it ONLY
// from the old seed — and from no other.
//
// A group is changed when ALL of these hold:
//   - it is the organisation's seeded finance group: key "finance" and id `${organizationId}_finance`;
//   - its permissions are still exactly one of the finance seeds that carried employees.manage
//     (FINANCE_SEEDS_WITH_HR — the same list as src/lib/permissions.ts, a test keeps them equal), i.e. the
//     owner never edited the group: an owner who added, removed or kept anything by hand decided, and his
//     group is left alone and listed as "kept";
//   - removing it does not leave a company that RUNS HR without its HR hands: when the company has employee
//     records, the finance group has members, and no other group of the company gives employees.manage (or
//     '*') to anyone, the group is listed under "review" and left — unless --include-review is passed. (The
//     owner is HR manager whatever happens: he passes every check.)
//
//   node scripts/migrate-hr-seed-groups.js uat                    — DRY RUN: lists what it would change
//   node scripts/migrate-hr-seed-groups.js uat --apply            — writes
//   node scripts/migrate-hr-seed-groups.js prod                   — dry run against production
//   node scripts/migrate-hr-seed-groups.js prod --apply           — OWNER ONLY, after reading the dry run
//
// Options:
//   --include-review   also strip the "review" groups (after the owner has named an HR manager)
//   --seed-hr-groups   also create the five HR groups the seed now writes (hr_manager, hr_gov, hr_payroll,
//                      hr_supervisor, management) for each company that has seeded groups and lacks them —
//                      at their deterministic ids, never overwriting a document that exists
//
// Idempotent: a group without employees.manage is not a candidate; nothing else is ever removed.
//
// Credentials: `.env.uat` / `.env.local` (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).

const HR = "employees.manage"

/** = FINANCE_SEEDS_WITH_HR in src/lib/permissions.ts (hr-seed-groups.test.ts keeps them equal). */
const FINANCE_SEEDS_WITH_HR = [
  ["projects.view", "projects.publish", "offers.view", "offers.accept", "invoices.manage", "employees.manage"],
  ["projects.view", "projects.publish", "offers.view", "offers.accept", "invoices.manage", "employees.manage", "accounting.view", "accounting.post"],
  ["projects.view", "projects.publish", "offers.view", "offers.accept", "po.approve", "invoices.manage", "employees.manage"],
  ["projects.view", "projects.publish", "offers.view", "offers.accept", "po.approve", "invoices.manage", "employees.manage", "accounting.view", "accounting.post"],
]

/** = the HR entries of SEEDED_GROUPS in src/lib/permissions.ts (the test keeps them equal). */
const HR_SEEDED_GROUPS = [
  { key: "hr_manager", name: "مدير الموارد البشرية", permissions: ["projects.view", "employees.manage"] },
  { key: "hr_gov", name: "العلاقات الحكومية وشؤون الموظفين", permissions: ["projects.view", "hr.gov"] },
  { key: "hr_payroll", name: "محاسب الرواتب", permissions: ["projects.view", "hr.payroll"] },
  { key: "hr_supervisor", name: "مشرف مكان العمل", permissions: ["projects.view", "hr.supervisor"] },
  { key: "management", name: "الإدارة", permissions: ["projects.view", "hr.management"] },
]

const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((x) => b.includes(x))
const untouchedSeed = (perms) => FINANCE_SEEDS_WITH_HR.some((seed) => sameSet(perms, seed))

/**
 * The plan, pure. `groups`: [{ id, organizationId, key, name, permissions }]; `members`: groupId → member count
 * (users whose DEFAULT group it is — HR roles come from the default group only); `orgsWithEmployees`: Set of
 * organisation ids that have at least one employee record.
 */
function planFor({ groups, members, orgsWithEmployees, includeReview = false, seedHrGroups = false }) {
  const strip = []
  const review = []
  const kept = []
  const byOrg = new Map()
  for (const g of groups) {
    const list = byOrg.get(g.organizationId) || []
    list.push(g)
    byOrg.set(g.organizationId, list)
  }
  for (const g of groups) {
    const perms = Array.isArray(g.permissions) ? g.permissions : []
    if (!perms.includes(HR) || perms.includes("*")) continue
    const seeded = g.key === "finance" && g.id === `${g.organizationId}_finance`
    if (!seeded) {
      kept.push({ ...g, why: "not the seeded finance group — an HR group the owner made" })
      continue
    }
    if (!untouchedSeed(perms)) {
      kept.push({ ...g, why: "the seeded finance group, edited by its owner since — his decision stands" })
      continue
    }
    const count = members.get(g.id) || 0
    const otherHr = (byOrg.get(g.organizationId) || []).some(
      (o) => o.id !== g.id && (members.get(o.id) || 0) > 0 && Array.isArray(o.permissions) && (o.permissions.includes(HR) || o.permissions.includes("*"))
    )
    const runsHr = orgsWithEmployees.has(g.organizationId)
    const entry = { ...g, members: count, runsHr, otherHr }
    if (count > 0 && runsHr && !otherHr && !includeReview) review.push({ ...entry, why: "its members may be the company's only HR hands (records exist, no other HR group has members)" })
    else strip.push(entry)
  }
  const create = []
  if (seedHrGroups) {
    for (const [org, list] of byOrg) {
      // Only a company whose groups were seeded (its finance or viewer seed is there) — never one the owner built by hand.
      if (!list.some((g) => g.id === `${org}_finance` || g.id === `${org}_viewer`)) continue
      for (const s of HR_SEEDED_GROUPS) if (!list.some((g) => g.id === `${org}_${s.key}`)) create.push({ id: `${org}_${s.key}`, organizationId: org, ...s })
    }
  }
  return { strip, review, kept, create }
}

module.exports = { FINANCE_SEEDS_WITH_HR, HR_SEEDED_GROUPS, planFor }

async function main() {
  const target = process.argv[2]
  const apply = process.argv.includes("--apply")
  const includeReview = process.argv.includes("--include-review")
  const seedHrGroups = process.argv.includes("--seed-hr-groups")
  if (target !== "uat" && target !== "prod") {
    console.error("usage: node scripts/migrate-hr-seed-groups.js <uat|prod> [--apply] [--include-review] [--seed-hr-groups]")
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
  const groupSnap = await db.collection("teamGroups").get()
  const groups = groupSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const members = new Map()
  const userSnap = await db.collection("users").select("defaultGroupId", "organizationId").get()
  for (const u of userSnap.docs) {
    const gid = u.get("defaultGroupId")
    if (typeof gid === "string" && gid) members.set(gid, (members.get(gid) || 0) + 1)
  }
  // Which candidate companies run HR — one read per company holding a finance group with employees.manage.
  const orgsWithEmployees = new Set()
  for (const org of new Set(groups.filter((g) => g.key === "finance" && (g.permissions || []).includes(HR)).map((g) => g.organizationId))) {
    const e = await db.collection("employees").where("organizationId", "==", org).limit(1).get()
    if (!e.empty) orgsWithEmployees.add(org)
  }
  const plan = planFor({ groups, members, orgsWithEmployees, includeReview, seedHrGroups })

  const line = (g) => `  ${g.id}  (${g.name || g.key || "?"}, org ${g.organizationId || "?"})`
  console.log(`${groups.length} groups, ${userSnap.size} users read.\n`)
  console.log(`− employees.manage would be removed from ${plan.strip.length} group(s):`)
  for (const g of plan.strip) console.log(`${line(g)} · ${g.members} member(s) · HR records: ${g.runsHr ? "yes" : "no"} · another HR group with members: ${g.otherHr ? "yes" : "no"}`)
  console.log(`\n? left for review (${plan.review.length}) — re-run with --include-review once the owner has named an HR manager:`)
  for (const g of plan.review) console.log(`${line(g)} · ${g.members} member(s) — ${g.why}`)
  console.log(`\n= kept (${plan.kept.length}):`)
  for (const g of plan.kept) console.log(`${line(g)} — ${g.why}`)
  if (seedHrGroups) {
    console.log(`\n+ HR groups to create (${plan.create.length}):`)
    for (const g of plan.create) console.log(`${line(g)} [${g.permissions.join(", ")}]`)
  }
  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.")
    return
  }
  let batch = db.batch()
  let n = 0
  const flush = async () => {
    if (++n % 400 === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  for (const g of plan.strip) {
    batch.update(db.collection("teamGroups").doc(g.id), { permissions: FieldValue.arrayRemove(HR), updatedAt: FieldValue.serverTimestamp() })
    await flush()
  }
  for (const g of plan.create) {
    // create(), not set(): a document that appeared since the read is never overwritten (the batch fails instead).
    batch.create(db.collection("teamGroups").doc(g.id), { organizationId: g.organizationId, key: g.key, name: g.name, permissions: g.permissions, isSystem: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    await flush()
  }
  await batch.commit()
  console.log(`\nDone: ${plan.strip.length} group(s) changed, ${plan.create.length} created.`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
