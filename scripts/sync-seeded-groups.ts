// Brings the SEEDED team groups of existing companies up to the permissions the code seeds today (src/lib/permissions.ts
// SEEDED_GROUPS). Existing groups are never re-seeded by the app, so a company created before a permission was added keeps
// a group that lacks it. ADDITIVE ONLY: it adds the missing ids and removes nothing, never creates a group, never touches a
// custom group. Dry run by default.
//
//   npx tsx scripts/sync-seeded-groups.ts uat                      — dry run, every company that has groups
//   npx tsx scripts/sync-seeded-groups.ts prod --org <orgId> ...   — dry run for named companies
//   npx tsx scripts/sync-seeded-groups.ts prod --org <orgId> --apply   — OWNER ONLY, after reading the dry run

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { PERMISSION_IDS, SEEDED_GROUPS, seededGroupDocId } from "../src/lib/permissions"

const argv = process.argv.slice(2)
const target = argv[0]
if (target !== "uat" && target !== "prod") throw new Error("usage: sync-seeded-groups.ts <uat|prod> [--org <orgId> ...] [--apply]")
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
  const known = new Set<string>([...PERMISSION_IDS, "*"])
  const groups = (await db.collection("teamGroups").get()).docs
  const orgs = [...new Set(groups.map((g) => g.data().organizationId as string).filter(Boolean))].filter((o) => only.length === 0 || only.includes(o))
  let planned = 0

  for (const org of orgs) {
    const lines: string[] = []
    for (const sg of SEEDED_GROUPS) {
      const ref = db.collection("teamGroups").doc(seededGroupDocId(org, sg.key))
      const snap = await ref.get()
      if (!snap.exists) continue
      const have = (snap.data()?.permissions as string[] | undefined) ?? []
      if (have.includes("*")) continue
      const missing = (sg.permissions as string[]).filter((p) => !have.includes(p) && known.has(p))
      if (!missing.length) continue
      lines.push(`   ${sg.key}: + ${missing.join(", ")}`)
      planned++
      if (apply) await ref.update({ permissions: FieldValue.arrayUnion(...missing), updatedAt: FieldValue.serverTimestamp() })
    }
    if (lines.length) console.log(`org ${org}\n${lines.join("\n")}`)
  }
  console.log(`\n${orgs.length} companies checked, ${planned} group(s) ${apply ? "updated" : "would be updated"}`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
