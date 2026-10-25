// IPC-07 — freezes the advance (`pm.advAmt`) on PM projects that started before it was stored. Each project is read,
// planned by `planAdvanceBackfill` (src/lib/pm/advance-backfill.ts: prj:ADV's amount › 0 when nobody pays or no
// advance › the first certificate's contract value × the original rate › the handover's figure × the rate), and
// written in ONE transaction that re-reads the project and writes only if `pm.advAmt` is still absent. A project
// still planning is skipped: it freezes at go-live.
//
//   npx tsx scripts/backfill-pm-advance.ts uat            — dry run: what each project would freeze at, and why
//   npx tsx scripts/backfill-pm-advance.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/backfill-pm-advance.ts uat --apply    — OWNER ONLY, after reading the dry run
//   --org <orgId>    only the named company (repeatable)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { planAdvanceBackfill } from "../src/lib/pm/advance-backfill"
import { lifecycleOf } from "../src/lib/pm/lifecycle"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: backfill-pm-advance.ts <uat|prod> [--apply] [--org <orgId> ...]")
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

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const projects = (await db.collection("projects").get()).docs.filter((d) => {
    const x = d.data() as { pm?: unknown; organizationId?: string }
    return Boolean(x.pm) && (!only.length || only.includes(x.organizationId || ""))
  })
  let planned = 0
  for (const d of projects) {
    const x = d.data() as { organizationId?: string; budget?: number | null; status?: string; name?: string; pm: { no?: string; lifecycle?: string; advAmt?: unknown; original?: { advance?: number; payer?: string } | null; terms?: { advance?: number; payer?: string } | null } }
    const org = x.organizationId || ""
    const ev = x.pm.no ? await db.collection("pmEvents").where("organizationId", "==", org).where("key", "==", `prj:ADV:${x.pm.no}`).limit(1).get() : null
    const eventAmount = ev && !ev.empty ? Number(ev.docs[0].data().amount) : null
    const certs = (await d.ref.collection("pmCertificates").get()).docs.map((c) => c.data() as { seq: number; status: string; contractValue?: number })
    const plan = planAdvanceBackfill({ lifecycle: lifecycleOf(x), budget: x.budget, pm: x.pm, eventAmount, certificates: certs })
    if (!plan) continue
    planned++
    console.log(`${apply ? "freeze   " : "would set"} ${org} · ${x.pm.no ?? d.id} (${x.name ?? ""}) → advAmt ${plan.advAmt} [${plan.source}]`)
    if (!apply) continue
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref)
      const pm = (snap.data() as { pm?: { advAmt?: unknown } }).pm
      if (!pm || typeof pm.advAmt === "number") return
      tx.update(d.ref, { "pm.advAmt": plan.advAmt })
    })
  }
  console.log(`\n${projects.length} PM projects read, ${planned} ${apply ? "frozen" : "would be frozen"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
