// READ-ONLY census of the accounts of one environment: who each company is, how old, what permission ids its groups
// carry that the code no longer knows, which groups a member points at that do not exist, how much data it holds, and
// whether POST /api/rfq-share/create would accept each of its RFQs (the route's own checks, replayed).
// Writes NOTHING.   npx tsx scripts/audit-accounts.ts uat      (gcloud user or .env.uat key)
//                   npx tsx scripts/audit-accounts.ts prod     (service account in .env.local)

import { config } from "dotenv"
import { resolve } from "path"
import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { PERMISSION_IDS, SEEDED_GROUPS, seededGroupDocId } from "../src/lib/permissions"

const target = process.argv[2]
if (target !== "uat" && target !== "prod") throw new Error("usage: audit-accounts.ts <uat|prod>")
config({ path: resolve(process.cwd(), target === "uat" ? ".env.uat" : ".env.local") })

type Doc = Record<string, unknown>

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

const ms = (v: unknown): number | null => {
  if (!v) return null
  if (typeof v === "object" && v !== null && "toDate" in v) return (v as { toDate: () => Date }).toDate().getTime()
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? null : t
}
const day = (v: unknown) => {
  const t = ms(v)
  return t ? new Date(t).toISOString().slice(0, 10) : "?"
}

async function main() {
  const { db, projectId } = await connect()
  console.log(`${target.toUpperCase()} · ${projectId} · read-only\n`)
  const known = new Set<string>([...PERMISSION_IDS, "*"])

  const users: Array<Doc & { id: string }> = (await db.collection("users").get()).docs.map((d) => ({ ...(d.data() as Doc), id: d.id }))
  const groups: Array<Doc & { id: string }> = (await db.collection("teamGroups").get()).docs.map((d) => ({ ...(d.data() as Doc), id: d.id }))
  const groupById = new Map(groups.map((g) => [g.id, g]))

  const orgOf = (u: Doc & { id: string }) => (u.organizationId as string) || u.id
  const byOrg = new Map<string, Array<Doc & { id: string }>>()
  for (const u of users) {
    if (u.role === "Admin") continue
    const o = orgOf(u)
    byOrg.set(o, [...(byOrg.get(o) ?? []), u])
  }

  const rows = [...byOrg.entries()].map(([org, members]) => {
    const owner = members.find((m) => m.id === org) ?? members.find((m) => m.organizationRole === "owner") ?? members[0]
    return { org, owner, members, created: Math.min(...members.map((m) => ms(m.createdAt) ?? Infinity)) }
  })
  rows.sort((a, b) => a.created - b.created)

  for (const r of rows) {
    const orgGroups = groups.filter((g) => g.organizationId === r.org)
    const count = async (c: string, f: string) => (await db.collection(c).where(f, "==", r.org).count().get()).data().count
    const [rfqs, offers, pos, projects] = await Promise.all([count("rfqs", "organizationId"), count("offers", "contractorOrgId"), count("purchaseOrders", "organizationId"), count("projects", "organizationId")])
    console.log(`── ${r.owner.email ?? r.owner.id} · ${r.owner.role} · ${(r.owner.companyName as string) || (r.owner.name as string) || ""}`)
    console.log(`   org ${r.org} · joined ${day(r.owner.createdAt)} · members ${r.members.length} · groups ${orgGroups.length} · rfqs ${rfqs} offers ${offers} orders ${pos} projects ${projects}`)
    const missingOrg = r.members.filter((m) => !m.organizationId && m.id !== r.org).length
    const noRole = r.members.filter((m) => !m.organizationRole).length
    if (missingOrg || noRole) console.log(`   ! ${missingOrg} member(s) without organizationId, ${noRole} account(s) without organizationRole (legacy owner shape)`)
    for (const g of orgGroups) {
      const perms = (g.permissions as string[] | undefined) ?? []
      const stale = perms.filter((p) => !known.has(p))
      if (stale.length) console.log(`   ! group "${g.name}" (${g.id}) carries ${stale.length} unknown permission id(s): ${stale.join(", ")}`)
    }
    if (orgGroups.length) {
      const byId = new Map(orgGroups.map((g) => [g.id, g]))
      const missing = SEEDED_GROUPS.filter((sg) => !byId.has(seededGroupDocId(r.org, sg.key))).map((sg) => sg.key)
      if (missing.length) console.log(`   ~ seeded groups this company does not have: ${missing.join(", ")}`)
      for (const sg of SEEDED_GROUPS) {
        const g = byId.get(seededGroupDocId(r.org, sg.key))
        if (!g) continue
        const have = new Set((g.permissions as string[] | undefined) ?? [])
        const add = (sg.permissions as string[]).filter((p) => !have.has(p))
        const extra = [...have].filter((p) => !(sg.permissions as string[]).includes(p))
        if (add.length || extra.length) console.log(`   ~ group ${sg.key}: lacks [${add.join(", ")}] · has beyond the seed [${extra.join(", ")}]`)
      }
      const custom = orgGroups.filter((g) => !SEEDED_GROUPS.some((sg) => seededGroupDocId(r.org, sg.key) === g.id))
      if (custom.length) console.log(`   ~ custom groups: ${custom.map((g) => `${String(g.name)} (${((g.permissions as string[] | undefined) ?? []).length} perms)`).join(" · ")}`)
    }
    for (const m of r.members) {
      const gid = m.defaultGroupId as string | undefined
      if (gid && !groupById.has(gid)) console.log(`   ! ${m.email ?? m.id} points at group ${gid} which does not exist`)
      if (gid && groupById.get(gid) && groupById.get(gid)!.organizationId !== r.org) console.log(`   ! ${m.email ?? m.id} points at a group of ANOTHER company (${gid})`)
    }

    if (rfqs) {
      const snap = await db.collection("rfqs").where("organizationId", "==", r.org).get()
      const bad: string[] = []
      for (const d of snap.docs) {
        const rfq = d.data() as Doc
        const why: string[] = []
        if (rfq.status !== "New") why.push(`status "${String(rfq.status)}" (only "New" can be shared)`)
        const rfqOrg = (rfq.organizationId as string) || (rfq.contractorId as string)
        for (const m of r.members) {
          const sender = (m.organizationId as string) || m.id
          if (m.organizationRole && rfqOrg !== sender) why.push(`${m.email ?? m.id}: RFQ org ${rfqOrg} != sender org ${sender}`)
        }
        if (why.length && rfq.status === "New") bad.push(`${d.id} "${String(rfq.title ?? "").slice(0, 40)}": ${why.join("; ")}`)
      }
      const published = snap.docs.filter((d) => (d.data() as Doc).status === "New").length
      console.log(`   rfq share check: ${published} published of ${rfqs}; ${bad.length} would be refused for an ownership mismatch`)
      bad.slice(0, 3).forEach((b) => console.log(`     · ${b}`))
    }
    console.log("")
  }
  console.log(`${rows.length} companies, ${users.length} users, ${groups.length} groups`)
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
