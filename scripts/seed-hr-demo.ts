/**
 * Seeds the HR module's demo into the UAT demo company (the owner's org that
 * scripts/seed-demo-workflow.ts created), so every HR screen shows something and
 * these flows can be clicked through without new logins:
 *
 *   1. People → new employee (an establishment with visas left) and an import.
 *   2. A workplace's sheet: this month's first day is unrecorded (declare it);
 *      last month is closed (pass --leave-workshop-open to leave the workshop's
 *      last month for you to close).
 *   3. Payroll: last month can be prepared (Finance = payroll), approved by the
 *      owner (a different user), then paid by Finance — a payslip appears in the
 *      employee's My file. The month before last is already paid.
 *   4. A pay change dated into last month, once its payroll is approved → the -D.
 *   5. My file → request a letter; the owner signs it from Today; print it.
 *   6. An exit started (custody waiting in Warehouses → Custody), then the
 *      settlement; a finished leaver (settled, paid, certificate issued) is there.
 *   7. As the supervisor: the project site, an injury, a correction by ID number.
 *
 * Who is who (no new accounts — the members are resolved by e-mail in the org):
 *   owner    shady+demo-owner@mdmaktech.sa    HR manager (the owner passes every check), approves
 *   finance  shady+demo-finance@mdmaktech.sa  Finance + payroll: `hr.payroll` added to his default group
 *   supply   shady+demo-supply@mdmaktech.sa   the project site's supervisor: `hr.supervisor` added
 *   viewer   shady+demo-viewer@mdmaktech.sa   the employee linked to a record (My file) — no HR permission
 * Permissions are only ever ADDED (arrayUnion), never removed.
 *
 * The documents come from src/lib/hr/demo-seed.ts (pure, tested in
 * src/__tests__/hr-demo-seed.test.ts) — computed by the module's own functions.
 * Ids are deterministic (`hrdemo-{orgId}-…` or the module's own ids). Every
 * document is created only if it does not exist — a document a tester changed
 * is never overwritten; sequences (mfgCounters, hrCounters) are raised, never
 * lowered. No journal entries are written (Accounting may be off on UAT).
 *
 * UAT ONLY — refuses any project but mdmaktech-uat. Dry run unless --apply.
 *
 *   npx tsx scripts/seed-hr-demo.ts --env .env.uat                 # dry run: what it would write
 *   npx tsx scripts/seed-hr-demo.ts --env .env.uat --apply         # write
 *   … --force-update        the demo exists already: create only what is missing
 *   … --owner <email>       another owner (default shady+demo-owner@mdmaktech.sa)
 *   … --finance/--supervisor/--employee <email>   other members (`--employee none`: no linked demo employee)
 *   … --staff <email>:<trade>:<site>,…   staff logins who are employees too — each gets a linked record
 *        (site: office | project | workshop; trade: a key of src/lib/hr/trades.ts, e.g. manager, accountant)
 *   … --leave-workshop-open the workshop's last month recorded but not closed
 */

import { config } from "dotenv"
import { resolve } from "path"

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? (process.argv[i + 1] ?? null) : null
}
const ENV_FILE = arg("--env") || ".env.uat"
config({ path: resolve(process.cwd(), ENV_FILE) })

import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app"
import { getFirestore, FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore"
import { buildHrDemo, DEMO_SEED_TAG, SERVER_TS, type DemoMember, type DemoWrite } from "@/lib/hr/demo-seed"
import { todayDay } from "@/lib/hr/format"
import { HR_EMPLOYEES, HR_LETTERS, HR_PAYROLLS, HR_REQUESTS } from "@/lib/hr/collections"
import { HR_SETTINGS } from "@/lib/hr/settings"
import { HR_COUNTERS } from "@/lib/hr/employee-writes"
import { payrollId } from "@/lib/hr/payroll"
import { MFG_COUNTERS } from "@/lib/manufacturing-engine"

const UAT_PROJECT = "mdmaktech-uat"
const APPLY = process.argv.includes("--apply")
const FORCE = process.argv.includes("--force-update")
const LEAVE_OPEN = process.argv.includes("--leave-workshop-open")
const EMAIL = {
  owner: arg("--owner") || "shady+demo-owner@mdmaktech.sa",
  finance: arg("--finance") || "shady+demo-finance@mdmaktech.sa",
  supervisor: arg("--supervisor") || "shady+demo-supply@mdmaktech.sa",
  employee: arg("--employee") || "shady+demo-viewer@mdmaktech.sa",
}
const DEMO_PROJECT_NAME = "مشروع فلل النخيل السكني"
const BATCH = 450

function initAdmin() {
  if (getApps().length > 0) return getApps()[0]!
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (projectId && clientEmail && privateKey) return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  return initializeApp({ credential: applicationDefault(), projectId })
}

interface UserDoc {
  uid: string
  name: string | null
  organizationId: string | null
  organizationRole: string | null
  defaultGroupId: string | null
  companyName: string | null
}

async function userByEmail(db: Firestore, email: string): Promise<UserDoc | null> {
  const snap = await db.collection("users").where("email", "==", email).limit(2).get()
  if (snap.size > 1) throw new Error(`two users/ documents carry ${email} — resolve that first`)
  const d = snap.docs[0]
  if (!d) return null
  const x = d.data() as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  return { uid: d.id, name: str(x.name), organizationId: str(x.organizationId), organizationRole: str(x.organizationRole), defaultGroupId: str(x.defaultGroupId), companyName: str(x.companyName) }
}

/** The admin SDK refuses `undefined`; the builder's sentinel becomes the server's timestamp. */
function toFirestore(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TS ? FieldValue.serverTimestamp() : v
  return out
}

async function existing(db: Firestore, refs: DocumentReference[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100))
    for (const s of snaps) if (s.exists) out.set(s.ref.path, s.data() as Record<string, unknown>)
  }
  return out
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "(none)"
  console.log(`Env file: ${ENV_FILE}\nFirebase project: ${projectId}`)
  if (projectId !== UAT_PROJECT) {
    console.error(`Refusing: the HR demo is seeded on ${UAT_PROJECT} only, never on ${projectId}.`)
    process.exit(2)
  }
  initAdmin()
  const db = getFirestore()
  const today = todayDay()
  console.log(`Today in Riyadh: ${today}${APPLY ? "" : "   (dry run — nothing is written)"}\n`)

  // ---- who is who ----------------------------------------------------------------
  const ownerDoc = await userByEmail(db, EMAIL.owner)
  if (!ownerDoc) throw new Error(`no users/ document for ${EMAIL.owner} — run scripts/seed-demo-workflow.ts --env .env.uat first`)
  if (ownerDoc.organizationRole && ownerDoc.organizationRole !== "owner") throw new Error(`${EMAIL.owner} is not an organization owner`)
  const orgId = ownerDoc.organizationId || ownerDoc.uid
  console.log(`Owner ${EMAIL.owner} → ${ownerDoc.uid} · org ${orgId}`)
  const member = async (role: "finance" | "supervisor" | "employee"): Promise<UserDoc | null> => {
    const u = await userByEmail(db, EMAIL[role])
    if (!u) console.warn(`  ! ${role}: no users/ document for ${EMAIL[role]} — seeded without him`)
    else if (u.organizationId !== orgId) {
      console.warn(`  ! ${role}: ${EMAIL[role]} belongs to org ${u.organizationId}, not ${orgId} — seeded without him`)
      return null
    } else console.log(`${role.padEnd(10)} ${EMAIL[role]} → ${u.uid} · default group ${u.defaultGroupId ?? "(none)"}`)
    return u
  }
  const financeDoc = await member("finance")
  const supervisorDoc = await member("supervisor")
  const employeeDoc = EMAIL.employee === "none" ? null : await member("employee")
  // Staff logins who are employees too (My file for every employee, staff included).
  const staff: NonNullable<Parameters<typeof buildHrDemo>[0]["staff"]> = []
  for (const item of (arg("--staff") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [email, trade, site] = item.split(":")
    if (!email || !trade || !["office", "project", "workshop"].includes(site)) throw new Error(`--staff: "${item}" is not email:trade:office|project|workshop`)
    const u = await userByEmail(db, email)
    if (!u || (u.organizationId || u.uid) !== orgId) {
      console.warn(`  ! staff: ${email} is not a member of ${orgId} — skipped`)
      continue
    }
    staff.push({ uid: u.uid, name: u.name, trade, site: site as "office" | "project" | "workshop" })
    console.log(`staff      ${email} → ${u.uid} · ${trade} at ${site}`)
  }
  const asMember = (u: UserDoc | null): DemoMember | null => (u ? { uid: u.uid, name: u.name } : null)

  // ---- the org's project, sequences, accounting ------------------------------------------
  const projects = await db.collection("projects").where("organizationId", "==", orgId).limit(20).get()
  const pdoc = projects.docs.find((p) => p.data().name === DEMO_PROJECT_NAME) ?? projects.docs[0] ?? null
  const project = pdoc ? { id: pdoc.id, name: String(pdoc.data().name ?? "مشروع") } : null
  console.log(`Project: ${project ? `${project.name} (${project.id})` : "none — the project site names no project and no manpower request is seeded"}`)

  const years = [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4))]
  const counterRefs = ["LV", "AV", "HQ", "LT"].flatMap((t) => years.map((y) => db.doc(`${MFG_COUNTERS}/${orgId}__${t}__${y}`)))
  const counterDocs = await existing(db, [...counterRefs, db.doc(`${HR_COUNTERS}/${orgId}`)])
  const yearly: Record<string, number> = {}
  for (const [path, data] of counterDocs) if (path.startsWith(MFG_COUNTERS)) yearly[path.split("__").slice(1).join("__")] = Number(data.last) || 0
  let lastEmployeeNo = Number(counterDocs.get(`${HR_COUNTERS}/${orgId}`)?.lastEmployeeNo) || 0
  // A second run (--force-update) numbers the demo's people as the first run did — their numbers are taken.
  const firstDemo = await db.doc(`${HR_EMPLOYEES}/hrdemo-${orgId}-emp-01`).get()
  if (firstDemo.exists && Number(firstDemo.data()?.no) > 0) lastEmployeeNo = Number(firstDemo.data()?.no) - 1
  const acc = await db.doc(`accounting_settings/${orgId}`).get()
  const accountingOn = acc.exists && acc.data()?.enabled === true
  console.log(`Accounting: ${accountingOn ? "ON" : "off"} — no journal entry is seeded either way${accountingOn ? " (the paid month and the settlement show as paid without one; hr:EOS waits on Finance's HR desk to be posted)" : ""}`)

  // ---- build ------------------------------------------------------------------------------
  const demo = buildHrDemo({
    orgId,
    today,
    owner: { uid: ownerDoc.uid, name: ownerDoc.name },
    finance: asMember(financeDoc),
    supervisor: asMember(supervisorDoc),
    employee: asMember(employeeDoc),
    staff,
    company: { name: ownerDoc.companyName },
    project,
    counters: { lastEmployeeNo, yearly },
    leaveWorkshopOpen: LEAVE_OPEN,
  })
  const { m0, m1, m2 } = demo.months
  console.log(`Months: paid ${m2} · closed, ready for payroll ${m1} · open ${m0}\n`)

  // ---- is the demo there already? ------------------------------------------------------------
  const settingsRef = db.doc(`${HR_SETTINGS}/${orgId}`)
  const firstEmp = db.doc(`${HR_EMPLOYEES}/${demo.employees[0].id}`)
  const mainPaid = db.doc(`${HR_PAYROLLS}/${payrollId(orgId, m2)}`)
  const pre = await existing(db, [settingsRef, firstEmp, mainPaid])
  const marked = (pre.get(settingsRef.path)?.demoSeed as { tag?: string } | undefined)?.tag === DEMO_SEED_TAG
  if ((marked || pre.has(firstEmp.path)) && !FORCE) {
    console.error("Refusing: the HR demo already exists in this company. --force-update creates only what is missing (nothing is overwritten).")
    process.exit(3)
  }
  if (pre.has(mainPaid.path) && !pre.has(firstEmp.path) && !FORCE) {
    console.error(`Refusing: hrPayrolls/${payrollId(orgId, m2)} exists and is not the demo's — the company already has HR data for ${m2}. --force-update keeps it and adds the rest.`)
    process.exit(3)
  }

  // ---- what exists, what would be written ------------------------------------------------------
  const refs = demo.writes.map((w) => db.doc(w.path))
  const have = await existing(db, refs)
  const toCreate: DemoWrite[] = []
  const counters: Array<DemoWrite & { from: number; to: number }> = []
  const kept: string[] = []
  for (const w of demo.writes) {
    if (w.mode !== "create") continue
    if (have.has(w.path)) kept.push(w.path)
    else toCreate.push(w)
  }
  // A sequence is raised to the highest number a document CREATED now carries — a kept document's number is
  // already behind its counter.
  const need = new Map<string, number>()
  const uses = (path: string, value: number) => need.set(path, Math.max(need.get(path) ?? 0, value))
  for (const w of toCreate) {
    const parts = w.path.split("/")
    const yearlyNo = parts[0] === HR_REQUESTS ? w.data.no : parts[0] === HR_LETTERS ? w.data.serial : null
    const m = typeof yearlyNo === "string" ? /^([A-Z]{2})-(\d{4})\/(\d+)$/.exec(yearlyNo) : null
    if (m) uses(`${MFG_COUNTERS}/${orgId}__${m[1]}__${m[2]}`, Number(m[3]))
    if (parts[0] === HR_EMPLOYEES && parts.length === 2) uses(`${HR_COUNTERS}/${orgId}`, Number(w.data.no))
  }
  for (const w of demo.writes.filter((x) => x.mode === "counter")) {
    const field = w.path.startsWith(HR_COUNTERS) ? "lastEmployeeNo" : "last"
    const from = Number(have.get(w.path)?.[field]) || 0
    const to = need.get(w.path) ?? 0
    if (to > from) counters.push({ ...w, data: { ...w.data, [field]: to }, from, to })
  }
  // An existing settings document keeps the tester's values; only the marker joins it.
  const markSettings = have.has(settingsRef.path) && !marked

  const byCollection = new Map<string, number>()
  for (const w of toCreate) {
    const parts = w.path.split("/")
    const c = parts.length > 2 ? `${parts[0]}/*/${parts[2]}` : parts[0]
    byCollection.set(c, (byCollection.get(c) ?? 0) + 1)
  }
  console.log(`${APPLY ? "Writing" : "Would write"} ${toCreate.length} documents:`)
  for (const [c, n] of [...byCollection].sort()) console.log(`  ${String(n).padStart(3)}  ${c}`)
  console.log("")
  for (const w of toCreate.filter((x) => !x.path.includes("/log/"))) console.log(`  + ${w.path}\n      ${w.note}`)
  console.log(`  + ${toCreate.filter((x) => x.path.includes("/log/")).length} log entries under employees/*/log (no amounts)`)
  for (const c of counters) console.log(`  ↑ ${c.path}: ${c.from} → ${c.to}`)
  if (markSettings) console.log(`  ~ ${settingsRef.path}: exists — only the demoSeed marker is added`)
  if (kept.length) console.log(`  = ${kept.length} already exist and are kept as they are${kept.length <= 12 ? `: ${kept.join(", ")}` : ""}`)

  // ---- group permissions -----------------------------------------------------------------------
  const grants: Array<{ group: string; permission: string; who: string }> = []
  for (const g of demo.grants) {
    const u = g.member === "finance" ? financeDoc : supervisorDoc
    if (!u) continue
    const expected = `${orgId}_${g.member === "finance" ? "finance" : "supply_chain"}`
    const group = u.defaultGroupId ?? expected
    if (group !== expected) console.warn(`  ! ${u.uid}'s default group is ${group}, not ${expected} — the permission goes to his DEFAULT group (that is where HR reads roles)`)
    const gs = await db.doc(`teamGroups/${group}`).get()
    if (!gs.exists) {
      console.warn(`  ! teamGroups/${group} does not exist — ${g.permission} not added; give ${EMAIL[g.member]} a group holding it`)
      continue
    }
    const perms = (gs.data()?.permissions as string[] | undefined) ?? []
    if (perms.includes(g.permission) || perms.includes("*")) console.log(`  · teamGroups/${group} already holds ${perms.includes("*") ? "*" : g.permission}`)
    else grants.push({ group, permission: g.permission, who: EMAIL[g.member] })
  }
  for (const g of grants) console.log(`  ${APPLY ? "+" : "would add"} permission ${g.permission} → teamGroups/${g.group} (${g.who})`)

  if (!APPLY) {
    console.log("\nDry run — add --apply to write.")
    return
  }

  // ---- write ----------------------------------------------------------------------------------
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = db.batch()
    for (const w of toCreate.slice(i, i + BATCH)) batch.create(db.doc(w.path), toFirestore(w.data))
    await batch.commit()
    console.log(`  committed ${Math.min(i + BATCH, toCreate.length)}/${toCreate.length}`)
  }
  for (const c of counters) {
    const field = c.path.startsWith(HR_COUNTERS) ? "lastEmployeeNo" : "last"
    await db.runTransaction(async (tx) => {
      const ref = db.doc(c.path)
      const s = await tx.get(ref)
      const cur = Number(s.data()?.[field]) || 0
      if (c.to > cur) tx.set(ref, toFirestore(c.data), { merge: true })
    })
  }
  if (markSettings) await settingsRef.set({ demoSeed: demo.writes.find((w) => w.path === settingsRef.path)?.data.demoSeed ?? { tag: DEMO_SEED_TAG } }, { merge: true })
  for (const g of grants) await db.doc(`teamGroups/${g.group}`).update({ permissions: FieldValue.arrayUnion(g.permission), updatedAt: FieldValue.serverTimestamp() })

  const linked = demo.employees.find((e) => e.id === demo.ids.linkedEmployee)
  const other = demo.employees.find((e) => e.id === demo.ids.leaving)
  console.log(`\nDone. Try:
  · as ${EMAIL.finance}: HR → Payroll → prepare ${m1}; as the owner approve it; as Finance pay it (Accounting → HR desk)
${linked ? `  · as ${EMAIL.employee}: HR → My file (#${linked.no}) — payslip ${m2}, the salary letter, a pending leave\n` : ""}${staff.length ? `  · as any staff login (${staff.length}): HR → My file — his own record, payslip ${m2}, leave balance\n` : ""}  · as the owner: Warehouses → Custody → clear #${other?.no}, then his file → approve the settlement
  · as ${EMAIL.supervisor}: HR → Workplaces → the project site — declare ${m0}'s first day, record an injury, raise a correction by ID number (e.g. ${demo.employees[6]?.idNo ?? ""}, a workshop mason)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
