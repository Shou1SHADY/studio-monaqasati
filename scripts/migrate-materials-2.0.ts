// Puts the Procurement 2.0 materials package onto the live tree (`categories/{rootId}`): the cleaned names, spec
// labels, option words and units, and the sale units of the six materials that have them. Only the text changes of
// data/materials-2.0/diff-report.json are applied, and only where the live text is still the old one — what the
// platform team renamed in Admin → Materials is left and listed. Nodes the team added or hid are never touched, and
// neither is the `__suggestions` document. Lines already written on RFQs keep the words of the moment they were picked.
//
//   npx tsx scripts/migrate-materials-2.0.ts uat            — dry run: what would change, what conflicts
//   npx tsx scripts/migrate-materials-2.0.ts prod           — the same for production (service account in .env.local)
//   npx tsx scripts/migrate-materials-2.0.ts uat --apply    — OWNER ONLY, after reading the dry run; UAT before prod
//
// --apply first writes every root document it is about to change to backups/materials-<env>-<time>.json.

import { config } from "dotenv"
import { resolve } from "path"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { mergeMaterialsPackage, type MaterialsPackageReport } from "../src/lib/materials/merge-shipped"
import { MATERIAL_SUGGESTIONS_DOC, MATERIAL_TREE, type MaterialRootDoc } from "../src/lib/materials/types"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: migrate-materials-2.0.ts <uat|prod> [--apply]")
const apply = argv.includes("--apply")
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
  const report = JSON.parse(readFileSync(resolve(process.cwd(), "data/materials-2.0/diff-report.json"), "utf8")) as MaterialsPackageReport
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will change"}\n`)

  const snap = await db.collection(MATERIAL_TREE).get()
  const docs = snap.docs.filter((d) => d.id !== MATERIAL_SUGGESTIONS_DOC && (d.data() as MaterialRootDoc).root).map((d) => ({ id: d.id, data: d.data() as MaterialRootDoc }))
  if (!docs.length) {
    console.log("`categories` is empty: screens read the shipped tree, which already carries the package. Nothing to do.")
    return
  }

  const out = mergeMaterialsPackage(docs.map((d) => d.data.root), report)
  console.log(`${docs.length} root documents · ${out.applied} text changes to apply · ${out.alreadyDone} already done · ${out.saleUnitsSet} sale units to set (${out.saleUnitsKept} kept as the team set them)`)
  if (out.missing.length) console.log(`${out.missing.length} node ids of the package are not in the database (an old import?): ${out.missing.slice(0, 10).join(", ")}${out.missing.length > 10 ? " …" : ""}`)
  if (out.conflicts.length) {
    console.log(`\n${out.conflicts.length} CONFLICTS — left as they are (the live text is neither the old nor the new one):`)
    for (const c of out.conflicts.slice(0, 60)) console.log(`  ${c.id} · ${c.at} · was «${c.from}» → «${c.to}» · live «${c.live}»`)
    if (out.conflicts.length > 60) console.log(`  … and ${out.conflicts.length - 60} more`)
  }
  const touched = docs.filter((d) => out.changedRootIds.includes(d.data.root.id))
  console.log(`\n${touched.length} root documents would be written: ${touched.map((d) => d.data.root.ar).join(" · ")}`)
  if (!apply) return

  mkdirSync(resolve(process.cwd(), "backups"), { recursive: true })
  const file = resolve(process.cwd(), "backups", `materials-${target}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify(touched.map((d) => ({ id: d.id, ...d.data }))))
  console.log(`backup: ${file}`)
  const at = new Date().toISOString()
  for (const d of touched) {
    const root = out.roots.find((r) => r.id === d.data.root.id)
    if (!root) continue
    await db.collection(MATERIAL_TREE).doc(d.id).set({ root, order: d.data.order, updatedAt: at, updatedBy: "migrate-materials-2.0" })
  }
  console.log(`wrote ${touched.length} root documents`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
