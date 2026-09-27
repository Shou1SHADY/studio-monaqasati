// HR 1.0 — brings employee records written by the old "Employees & salaries"
// page onto the HR 1.0 card (EM-01, EM-02, RL-03):
//
//   · `salary` leaves the card: it becomes `employeePay/{id}` with the old
//     figure as BASIC and no allowances, flagged `needsSplit` so the HR manager
//     splits it into basic + housing + transport — the old page stored one
//     total, and inventing a split would be an invented number.
//     (The card was readable by every member; pay now is not.)
//   · every record gets a permanent number (`no`), per company, in the order
//     they were created, continuing `hrCounters/{orgId}`;
//   · `names.ar` from `name`, status active, category from nothing (left
//     "staff" when the old role says nothing), unassigned, probation decided.
//
//   node scripts/migrate-hr-employees.js uat            — DRY RUN: lists what it would change
//   node scripts/migrate-hr-employees.js uat  --apply   — writes
//   node scripts/migrate-hr-employees.js prod           — dry run against production
//   node scripts/migrate-hr-employees.js prod --apply   — OWNER ONLY, after reading the dry run
//
// Idempotent: a record that already has `no` and no `salary` is skipped.

const target = process.argv[2]
const apply = process.argv.includes("--apply")
if (target !== "uat" && target !== "prod") {
  console.error("usage: node scripts/migrate-hr-employees.js <uat|prod> [--apply]")
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

;(async () => {
  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}\n`)
  const snap = await db.collection("employees").get()
  const byOrg = new Map()
  for (const d of snap.docs) {
    const data = d.data()
    const org = data.organizationId || "?"
    if (!byOrg.has(org)) byOrg.set(org, [])
    byOrg.get(org).push({ id: d.id, data })
  }
  let changed = 0
  for (const [org, list] of byOrg) {
    const todo = list.filter((x) => x.data.no == null || "salary" in x.data)
    if (!todo.length) continue
    const counterRef = db.collection("hrCounters").doc(org)
    const counter = await counterRef.get()
    let last = counter.exists ? counter.data().lastEmployeeNo || 0 : 0
    const sorted = todo.slice().sort((a, b) => String(a.data.createdAt?.toDate?.() ?? "").localeCompare(String(b.data.createdAt?.toDate?.() ?? "")))
    console.log(`org ${org}: ${todo.length} of ${list.length} records to bring over`)
    const batch = db.batch()
    for (const x of sorted) {
      const d = x.data
      const no = d.no != null ? d.no : ++last
      const card = {
        no,
        names: d.names || { ar: d.name || "", en: null },
        status: d.status || "active",
        category: d.category || "staff",
        siteId: d.siteId ?? null,
        docs: d.docs || {},
        leaveTaken: d.leaveTaken ?? 0,
        probation: d.probation || { end: "1970-01-01", decision: "confirmed", decidedOn: null, consentOn: null },
        contract: d.contract || { type: "open", end: null },
        source: d.source || "local",
        updatedAt: FieldValue.serverTimestamp(),
      }
      console.log(`  ${x.id}  no ${no}  "${d.name || d.names?.ar || "?"}"${"salary" in d ? `  salary ${d.salary} → employeePay.basic (needsSplit)` : ""}`)
      if (!apply) continue
      batch.set(db.collection("employees").doc(x.id), { ...card, salary: FieldValue.delete() }, { merge: true })
      if ("salary" in d) {
        batch.set(db.collection("employeePay").doc(x.id), {
          employeeId: x.id, organizationId: org, basic: Number(d.salary) || 0, housing: 0, transport: 0,
          iban: null, ibanState: null, advance: null, retro: [], needsSplit: true, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      changed++
    }
    if (apply) {
      batch.set(counterRef, { organizationId: org, lastEmployeeNo: last, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await batch.commit()
    }
  }
  console.log(apply ? `\nDone: ${changed} records brought over.` : "\nRe-run with --apply to write.")
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
