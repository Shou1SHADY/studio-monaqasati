/**
 * Seeds the Supplier 1.0 FREE account demo on UAT: a free supplier (owner of «مؤسسة الركائز لمواد البناء»), two
 * contractor companies (A with a site receiver, B), and every state the free journey shows — 30 open requests (8 new,
 * 2 invitations by name, 1 archived, 1 declined), quotes in every group, orders in every segment (to accept, due soon,
 * late by 2 days, reported, partly received, received with a difference, received to invoice), invoices (50/50 with an
 * overdue instalment, a transfer to confirm, one «not received», paid), a rating owed and one given, a warranty waiting
 * and one accepted, a connection and an invitation to connect, conversations and notifications.
 *
 * The documents come from src/lib/supplier-free/demo-seed.ts (pure; src/__tests__/supplier-free-demo-seed.test.ts
 * derives the supplier's world from them as FreeWorldProvider does and runs the server acts over them). Dates are
 * relative to today in Riyadh, so re-running keeps the states meaningful.
 *
 *   npx tsx scripts/seed-supplier-free-demo.ts uat                    dry run: accounts found, what would be written
 *   npx tsx scripts/seed-supplier-free-demo.ts uat --apply            create/reuse the 4 accounts, write the demo
 *   npx tsx scripts/seed-supplier-free-demo.ts uat --reset            dry run of the reset: what would be deleted
 *   npx tsx scripts/seed-supplier-free-demo.ts uat --reset --apply    delete the demo's documents, then write it again
 *
 * UAT ONLY: any target but `uat` is refused, and so is an env file whose project is not mdmaktech-uat. Credentials are
 * the service account in .env.uat (Auth users need the Admin SDK). Idempotent: every document id is deterministic
 * (`sfdemo_…` or a demo account's key); accounts are reused by e-mail and their password RESET to a new one each
 * --apply, so the printed password always works. Settings and permission groups are created only when absent;
 * sequences (mfgCounters) are raised, never lowered.
 *
 * --reset deletes only: documents whose id starts with `sfdemo_`, and documents owned by the demo SUPPLIER's company
 * (his quotes, the orders to him and their receipts, his invoices/locks/transfers/warranties, his conversations,
 * links and invitations, reviews by or of him, his notifications and workspace) — so a demo clicked through is put
 * back as seeded. Contractor RFQs are deleted only by the prefix; counters, groups, settings and accounts are kept.
 *
 * At the end the accounts (e-mail · password · role · what to open) are printed and written to
 * ../uat-seed-accounts-supplier-free.txt — OUTSIDE the repository, never inside it.
 */

import { randomBytes } from "crypto"
import { writeFileSync } from "fs"
import { resolve, relative, isAbsolute } from "path"
import { config } from "dotenv"
import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth, type Auth } from "firebase-admin/auth"
import { FieldPath, getFirestore, type DocumentReference, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { buildSupplierFreeDemo, DEMO_EMAILS, DEMO_PEOPLE, DEMO_PREFIX, demoWorld, type DemoDoc, type DemoIds, type DemoRole } from "@/lib/supplier-free/demo-seed"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"

const UAT_PROJECT = "mdmaktech-uat"
const argv = process.argv.slice(2)
const target = argv[0]
const APPLY = argv.includes("--apply")
const RESET = argv.includes("--reset")
if (target !== "uat") {
  console.error("usage: seed-supplier-free-demo.ts uat [--apply] [--reset]   (UAT only — any other target is refused)")
  process.exit(2)
}
config({ path: resolve(process.cwd(), ".env.uat") })
const ACCOUNTS_FILE = resolve(process.cwd(), "..", "uat-seed-accounts-supplier-free.txt")
const ROLES: DemoRole[] = ["supplier", "contractorA", "receiverA", "contractorB"]
const BATCH = 400

interface Conn {
  db: Firestore
  auth: Auth
}

function connect(): Conn | null {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (projectId !== UAT_PROJECT) throw new Error(`refusing: .env.uat points at "${projectId || "(nothing)"}", this seed only touches ${UAT_PROJECT}`)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!clientEmail || !privateKey) return null
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId })
  if (app.options.projectId !== UAT_PROJECT) throw new Error("refusing: the Admin app is not on mdmaktech-uat")
  return { db: getFirestore(app), auth: getAuth(app) }
}

const newPassword = () => `${randomBytes(15).toString("base64url")}#7`

/** Each account by e-mail: its uid when it exists. A users/ doc of another role is refused — never repurposed. */
async function lookup(c: Conn): Promise<Partial<Record<DemoRole, string>>> {
  const out: Partial<Record<DemoRole, string>> = {}
  for (const role of ROLES) {
    const email = DEMO_EMAILS[role]
    const user = await c.auth.getUserByEmail(email).catch(() => null)
    if (!user) continue
    const doc = (await c.db.doc(`users/${user.uid}`).get()).data() as { role?: string; organizationId?: string } | undefined
    if (doc?.role && doc.role !== DEMO_PEOPLE[role].role) throw new Error(`refusing: ${email} exists as a ${doc.role}, the demo needs a ${DEMO_PEOPLE[role].role}`)
    out[role] = user.uid
  }
  if (out.receiverA && out.contractorA) {
    const r = (await c.db.doc(`users/${out.receiverA}`).get()).data() as { organizationId?: string } | undefined
    if (r?.organizationId && r.organizationId !== out.contractorA) throw new Error(`refusing: ${DEMO_EMAILS.receiverA} belongs to another company (${r.organizationId})`)
  }
  return out
}

async function ensureAccounts(c: Conn): Promise<{ ids: DemoIds; passwords: Record<DemoRole, string>; created: DemoRole[] }> {
  const passwords = {} as Record<DemoRole, string>
  const ids = {} as Record<DemoRole, string>
  const created: DemoRole[] = []
  for (const role of ROLES) {
    const email = DEMO_EMAILS[role]
    const password = newPassword()
    const existing = await c.auth.getUserByEmail(email).catch(() => null)
    if (existing) {
      await c.auth.updateUser(existing.uid, { password, emailVerified: true, displayName: DEMO_PEOPLE[role].name, disabled: false })
      ids[role] = existing.uid
    } else {
      const u = await c.auth.createUser({ email, password, emailVerified: true, displayName: DEMO_PEOPLE[role].name })
      ids[role] = u.uid
      created.push(role)
    }
    passwords[role] = password
  }
  return { ids: ids as DemoIds, passwords, created }
}

// ---- reset ------------------------------------------------------------------------------------------------------

const PREFIXED = ["rfqs", "offers", "purchaseOrders", "deliveries", "supplierInvoices", "supplierTransfers", "supplierWarranties", "contractorSupplierLinks", "invitations", "reviews", "chats"]
const SUPPLIER_OWNED: [string, string][] = [
  ["offers", "organizationId"],
  ["purchaseOrders", "supplierOrgId"],
  ["supplierInvoices", "supplierOrgId"],
  ["supplierInvoiceLocks", "supplierOrgId"],
  ["supplierTransfers", "supplierOrgId"],
  ["supplierWarranties", "supplierOrgId"],
  ["chats", "supplierOrgId"],
  ["contractorSupplierLinks", "supplierOrgId"],
  ["reviews", "reviewerOrgId"],
  ["reviews", "revieweeId"],
]

async function resetPlan(c: Conn, ids: Partial<DemoIds>): Promise<DocumentReference[]> {
  const refs = new Map<string, DocumentReference>()
  const add = (r: DocumentReference) => refs.set(r.path, r)
  const byPrefix = async (col: string) => {
    const snap = await c.db.collection(col).where(FieldPath.documentId(), ">=", DEMO_PREFIX).where(FieldPath.documentId(), "<", `${DEMO_PREFIX}`).get()
    snap.docs.forEach((d) => add(d.ref))
  }
  for (const col of PREFIXED) await byPrefix(col)
  // The supplier's rating of a contractor is keyed by its order: po_<poId>_supplier.
  const rated = await c.db.collection("reviews").where(FieldPath.documentId(), ">=", `po_${DEMO_PREFIX}`).where(FieldPath.documentId(), "<", `po_${DEMO_PREFIX}`).get()
  rated.docs.forEach((d) => add(d.ref))

  const sup = ids.supplier
  if (sup) {
    for (const [col, field] of SUPPLIER_OWNED) (await c.db.collection(col).where(field, "==", sup).get()).docs.forEach((d) => add(d.ref))
    ;(await c.db.collection("invitations").where("email", "==", DEMO_EMAILS.supplier).get()).docs.forEach((d) => add(d.ref))
    ;(await c.db.collection(`users/${sup}/notifications`).get()).docs.forEach((d) => add(d.ref))
    const ws = c.db.doc(`supplierWorkspace/${sup}`)
    if ((await ws.get()).exists) add(ws)
  }
  // Receipts of every order being deleted, messages of every conversation, questions on the demo's requests.
  const poIds = [...refs.values()].filter((r) => r.parent.id === "purchaseOrders").map((r) => r.id)
  for (let i = 0; i < poIds.length; i += 30) (await c.db.collection("deliveries").where("poId", "in", poIds.slice(i, i + 30)).get()).docs.forEach((d) => add(d.ref))
  for (const r of [...refs.values()]) {
    if (r.parent.id === "chats" && r.parent.parent == null) (await r.collection("messages").get()).docs.forEach((d) => add(d.ref))
    if (r.parent.id === "rfqs" && r.parent.parent == null) (await r.collection("inquiries").get()).docs.forEach((d) => add(d.ref))
  }
  // The demo contractors' notifications about a deleted request, quote or order.
  const gone = new Set([...refs.values()].map((r) => r.id))
  for (const uid of [ids.contractorA, ids.receiverA, ids.contractorB].filter((x): x is string => !!x)) {
    for (const d of (await c.db.collection(`users/${uid}/notifications`).get()).docs) {
      const n = d.data() as { rfqId?: string; poId?: string; offerId?: string; chatId?: string }
      if ([n.rfqId, n.poId, n.offerId, n.chatId].some((x) => !!x && gone.has(x))) add(d.ref)
    }
  }
  return [...refs.values()]
}

// ---- write ------------------------------------------------------------------------------------------------------

async function writeDocs(c: Conn, docs: DemoDoc[]): Promise<{ written: number; skipped: number }> {
  // What `create` and `max` must know first.
  const needRead = docs.filter((d) => d.mode === "create" || d.mode === "max").map((d) => c.db.doc(d.path))
  const existing = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < needRead.length; i += 100) for (const s of await c.db.getAll(...needRead.slice(i, i + 100))) if (s.exists) existing.set(s.ref.path, s.data() as Record<string, unknown>)
  let written = 0
  let skipped = 0
  let batch = c.db.batch()
  let n = 0
  for (const d of docs) {
    const ref = c.db.doc(d.path)
    const prev = existing.get(d.path)
    if (d.mode === "create" && prev) {
      skipped++
      continue
    }
    if (d.mode === "max") batch.set(ref, { ...d.data, last: Math.max(Number(prev?.last) || 0, Number(d.data.last) || 0) })
    else if (d.mode === "merge") batch.set(ref, d.data, { merge: true })
    else batch.set(ref, d.data)
    written++
    if (++n === BATCH) {
      await batch.commit()
      batch = c.db.batch()
      n = 0
    }
  }
  if (n) await batch.commit()
  return { written, skipped }
}

async function deleteRefs(c: Conn, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH) {
    const b = c.db.batch()
    refs.slice(i, i + BATCH).forEach((r) => b.delete(r))
    await b.commit()
  }
}

// ---- report -----------------------------------------------------------------------------------------------------

function summarize(docs: DemoDoc[], ids: DemoIds, today: string, keys: Record<string, string>) {
  const byCol = new Map<string, number>()
  for (const d of docs) {
    const parts = d.path.split("/")
    const col = parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 2]}` : parts[0]
    byCol.set(col, (byCol.get(col) || 0) + 1)
  }
  console.log(`\n${docs.length} documents:`)
  for (const [col, n] of [...byCol].sort()) console.log(`  ${col.padEnd(34)} ${n}`)
  const world = demoWorld(docs, ids.supplier, today)
  const L = createWorldLogic(today, world, 0.15)
  console.log(`\nWhat the supplier sees (${today}):`)
  console.log(`  stages   ${L.segCounts().map(([s, n]) => `${s} ${n}`).join(" · ")}`)
  const b = L.badges()
  console.log(`  sidebar  today ${b.home.n} · requests ${b.opps.n} new · quotes ${b.offers.n} · orders ${b.orders.n} · invoices ${b.invoices.n} · connections ${b.connections.n} · messages ${b.messages.n}`)
  console.log(`  tasks    ${L.allActs().map((a) => a.kind).join(", ")}`)
  console.log("  deals with a quote:")
  for (const d of world.deals.filter((x) => x.offer)) console.log(`    ${d.rfq}  ${L.stage(d).padEnd(8)} ${keys[d.id] || ""}`)
}

function accountsText(ids: DemoIds, passwords: Record<DemoRole, string> | null, today: string): string {
  const rows = ROLES.map((r) => [DEMO_EMAILS[r], passwords ? passwords[r] : "(set on --apply)", DEMO_PEOPLE[r].role, DEMO_PEOPLE[r].what])
  const w = [0, 1, 2].map((k) => Math.max(...rows.map((x) => x[k].length)))
  const lines = rows.map((x) => `${x[0].padEnd(w[0])}  ${x[1].padEnd(w[1])}  ${x[2].padEnd(w[2])}  ${x[3]}`)
  return [`Supplier 1.0 free-account demo — UAT (${UAT_PROJECT}) — seeded ${today}`, "https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app", "", ...lines, "", `uids: ${ROLES.map((r) => `${r}=${ids[r]}`).join(" ")}`, ""].join("\n")
}

async function main() {
  const today = riyadhDay()
  const c = connect()
  console.log(`UAT · ${UAT_PROJECT} · today in Riyadh ${today} · ${APPLY ? "APPLYING" : "dry run — nothing will change"}${RESET ? " · with --reset" : ""}`)
  if (!c) {
    if (APPLY) throw new Error("refusing --apply: .env.uat has no service account (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) — Auth users need the Admin SDK")
    console.log("No service account in .env.uat: planning offline with placeholder uids.")
  }

  const found = c ? await lookup(c) : {}
  for (const r of ROLES) console.log(`  ${r.padEnd(12)} ${DEMO_EMAILS[r].padEnd(42)} ${found[r] ? `exists → ${found[r]} (password will be reset)` : "new — will be created"}`)

  if (!APPLY) {
    const ids: DemoIds = { supplier: found.supplier || "<supplier-uid>", contractorA: found.contractorA || "<contractorA-uid>", receiverA: found.receiverA || "<receiverA-uid>", contractorB: found.contractorB || "<contractorB-uid>" }
    if (RESET && c) {
      const refs = await resetPlan(c, found)
      console.log(`\n--reset would delete ${refs.length} documents:`)
      const byCol = new Map<string, number>()
      for (const r of refs) byCol.set(r.parent.path.replace(/^users\/[^/]+/, "users/…"), (byCol.get(r.parent.path.replace(/^users\/[^/]+/, "users/…")) || 0) + 1)
      for (const [col, n] of [...byCol].sort()) console.log(`  ${col.padEnd(34)} ${n}`)
    }
    const { docs, keys } = buildSupplierFreeDemo(ids, today, { inviteToken: "dry-run" })
    summarize(docs, ids, today, keys)
    console.log(`\nDry run. Re-run with --apply to write; the accounts will be printed and saved to ${ACCOUNTS_FILE}.`)
    return
  }

  const conn = c as Conn
  const { ids, passwords, created } = await ensureAccounts(conn)
  console.log(`\nAccounts: ${created.length ? `created ${created.join(", ")}; ` : ""}passwords reset for all four.`)
  if (RESET) {
    const refs = await resetPlan(conn, ids)
    await deleteRefs(conn, refs)
    console.log(`Reset: deleted ${refs.length} documents.`)
  }
  const { docs, keys } = buildSupplierFreeDemo(ids, today, { inviteToken: randomBytes(32).toString("hex") })
  const { written, skipped } = await writeDocs(conn, docs)
  console.log(`Wrote ${written} documents (${skipped} create-only already present, kept).`)
  summarize(docs, ids, today, keys)

  const text = accountsText(ids, passwords, today)
  const rel = relative(process.cwd(), ACCOUNTS_FILE)
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error(`refusing to write the accounts inside the repository (${ACCOUNTS_FILE})`)
  writeFileSync(ACCOUNTS_FILE, text, { mode: 0o600 })
  console.log(`\n${text}\nSaved to ${ACCOUNTS_FILE} (outside the repository).`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
)
