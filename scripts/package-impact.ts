// Procurement 2.0 (NFR-08, S1 risk 2): a package change is a migration of stored state, and the read-time filters that used to hide a
// closed connector's records are gone. This reports, for every company with a package document, what the migration job would do for
// each connector the company ALREADY has closed — the project requests still open that stay on the Incoming desk, the orders awaiting
// Finance's payment that are stamped to end at receipt, the workshop questions handed back to the buyer, the project sites turned into
// ordinary sites — counted from its live records. Read the dry run per company before the job runs on production.
//
//   npx tsx scripts/package-impact.ts uat            — dry run: the counts per company (nothing is written)
//   npx tsx scripts/package-impact.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/package-impact.ts prod --apply   — OWNER ONLY, after reading the dry run: runs the job for each closed connector
//   --org <orgId>    only the named company (repeatable)
//
// The job never deletes a document, never reopens a closed order or a received line, and a second run changes nothing. A company with
// no `companyModules` document is the full package: it has nothing closed and is not listed.

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES } from "../src/lib/company-modules"
import { companyImpact } from "../src/lib/procurement/package-impact-report"
import { applyConnectorChange, loadPackageSnapshot } from "../src/lib/procurement/package-migration-server"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: package-impact.ts <uat|prod> [--apply] [--org <orgId> ...]")
const apply = argv.includes("--apply")
const only = argv.flatMap((a, i) => (a === "--org" ? [argv[i + 1]] : []))
config({ path: resolve(process.cwd(), target === "uat" ? ".env.uat" : ".env.local") })

async function connect(): Promise<{ db: Firestore; projectId: string }> {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (process.env.FIREBASE_PRIVATE_KEY) {
    if (target === "uat" && projectId !== "mdmaktech-uat") throw new Error(`refusing: .env.uat points at ${projectId}`)
    if (target === "prod" && projectId === "mdmaktech-uat") throw new Error("refusing: .env.local points at UAT")
    if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY as string).replace(/\n/g, "\n") }), projectId })
    return { db: getFirestore(), projectId: projectId as string }
  }
  if (target === "prod") throw new Error("production needs its service account in .env.local")
  const { openUatDb } = await import("./lib/uat-db")
  return { db: openUatDb().db as unknown as Firestore, projectId: "mdmaktech-uat" }
}

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)
  const docs = (await db.collection(COMPANY_MODULES).get()).docs.filter((d) => !only.length || only.includes(d.id))
  let companies = 0
  let touched = 0
  for (const d of docs) {
    const off = Array.isArray(d.data().off) ? (d.data().off as string[]) : []
    const snapshot = await loadPackageSnapshot(db, d.id)
    const report = companyImpact(snapshot, off)
    if (!report.closed.length) continue
    const profile = ((await db.collection("users").doc(d.id).get()).data() ?? {}) as { companyName?: string; name?: string }
    companies++
    touched += report.touches
    console.log(`${d.id} · ${profile.companyName || profile.name || "—"} · package ${report.state} · closed: ${report.closed.join(", ")}${snapshot.projectsCapped ? " · 300+ projects (counted on the first 300)" : ""}`)
    for (const row of report.rows) {
      const counts = Object.entries(row.impact).filter(([, n]) => n)
      console.log(`  ${row.conn}: ${counts.length ? counts.map(([k, n]) => `${k} ${n}`).join(" · ") : "nothing to hand back"}${row.steps.length ? ` · steps ${row.steps.map((s) => s.kind).join(", ")}` : ""}`)
    }
    if (!apply) continue
    for (const conn of report.closed) {
      const applied = await applyConnectorChange(db, d.id, conn, "off", { actor: { uid: "package-impact", name: "package-impact script" }, off })
      console.log(`  applied ${conn}: ${Object.keys(applied).length ? JSON.stringify(applied) : "nothing (already done)"}`)
    }
  }
  console.log(`\n${docs.length} package documents · ${companies} with a closed connector · ${touched} records ${apply ? "handled" : "would be handled"}`)
  if (!apply) console.log("Run again with --apply to run the job for each closed connector. Nothing is deleted.")
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
