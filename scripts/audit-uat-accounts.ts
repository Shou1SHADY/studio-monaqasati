/**
 * READ-ONLY audit of UAT accounts before they are shared with a client: for each e-mail, whether the sign-in
 * exists, which company it belongs to, whether it is the owner, its default permission group and the HR roles
 * that group gives (HR reads roles from the DEFAULT group — src/lib/hr/access.ts), whether a login is linked to
 * an employee record (My file), and which workplaces it supervises. Then the company's HR state: settings,
 * features, workplaces, employees, payrolls, and the permission groups that exist.
 *
 * Writes NOTHING. UAT only (refuses any project but mdmaktech-uat). E-mails are passed on the command line so
 * client addresses stay out of the repo:
 *   npx tsx scripts/audit-uat-accounts.ts --env .env.uat a@x.sa b@x.sa …
 */

import { config } from "dotenv"
import { resolve } from "path"

const argv = process.argv.slice(2)
const envAt = argv.indexOf("--env")
const ENV_FILE = envAt !== -1 ? argv[envAt + 1] : ".env.uat"
const emails = argv.filter((a, i) => !a.startsWith("--") && !(envAt !== -1 && i === envAt + 1))
config({ path: resolve(process.cwd(), ENV_FILE) })

import { initializeApp, cert, getApps } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

const UAT_PROJECT = "mdmaktech-uat"
const HR_PERMS: Record<string, string> = {
  "employees.manage": "HR manager",
  "hr.gov": "government relations",
  "hr.payroll": "payroll",
  "hr.supervisor": "site supervisor",
  "hr.management": "management",
  "invoices.manage": "Finance",
  "accounting.post": "Finance",
}

function app() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (projectId !== UAT_PROJECT) throw new Error(`refusing: ${ENV_FILE} points at "${projectId}", not ${UAT_PROJECT}`)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!clientEmail || !privateKey) throw new Error(`no service account in ${ENV_FILE}`)
  return getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

async function main() {
  if (!emails.length) throw new Error("pass the e-mails to audit")
  const a = app()
  const auth = getAuth(a)
  const db = getFirestore(a)
  console.log(`Project: ${process.env.FIREBASE_PROJECT_ID} (read-only)\n`)
  const orgs = new Set<string>()
  const groupCache = new Map<string, { name: string; permissions: string[] } | null>()
  const group = async (id: string | null | undefined) => {
    if (!id) return null
    if (!groupCache.has(id)) {
      const g = await db.collection("teamGroups").doc(id).get()
      groupCache.set(id, g.exists ? { name: String(g.get("name") ?? id), permissions: (g.get("permissions") as string[]) ?? [] } : null)
    }
    return groupCache.get(id) ?? null
  }

  for (const email of emails) {
    const authUser = await auth.getUserByEmail(email).catch(() => null)
    if (!authUser) {
      console.log(`✗ ${email} — no sign-in on UAT`)
      continue
    }
    const u = await db.collection("users").doc(authUser.uid).get()
    if (!u.exists) {
      console.log(`✗ ${email} — sign-in exists (uid ${authUser.uid}) but no users/ profile`)
      continue
    }
    const d = u.data() as Record<string, unknown>
    const orgId = String(d.organizationId ?? authUser.uid)
    orgs.add(orgId)
    const owner = !("organizationRole" in d) || d.organizationRole === "owner" || orgId === authUser.uid
    const g = await group(d.defaultGroupId as string | undefined)
    const perms = g?.permissions ?? []
    const hr = owner || perms.includes("*") ? ["owner/all — every HR role"] : [...new Set(perms.filter((p) => HR_PERMS[p]).map((p) => HR_PERMS[p]))]
    const emp = await db.collection("employees").where("organizationId", "==", orgId).where("userId", "==", authUser.uid).limit(2).get()
    const sites = await db.collection("hrSites").where("organizationId", "==", orgId).where("supervisorUserId", "==", authUser.uid).get()
    console.log(`✓ ${email}`)
    console.log(`    name: ${d.name ?? "—"} · role: ${d.role ?? "—"} · company: ${orgId}${owner ? " · OWNER" : ` · ${d.organizationRole}`}`)
    console.log(`    verified: ${d.isVerified === true ? "yes" : "no"} · profile completed: ${d.profileCompleted === true ? "yes" : "no"} · disabled: ${authUser.disabled ? "YES" : "no"}`)
    console.log(`    default group: ${d.defaultGroupId ?? "—"}${g ? ` («${g.name}», ${perms.length} permissions)` : d.defaultGroupId ? " (MISSING group doc)" : ""}`)
    console.log(`    HR/Finance roles: ${hr.length ? hr.join(", ") : "none — sees only My file (if linked) in HR"}`)
    console.log(`    linked employee record: ${emp.empty ? "none — My file is empty" : emp.docs.map((x) => `#${x.get("no")} ${x.get("names")?.ar ?? ""}`).join(", ")}${emp.size > 1 ? " (TWO — should be one)" : ""}`)
    console.log(`    supervises: ${sites.empty ? "no workplace" : sites.docs.map((x) => x.get("name")).join(", ")}`)
  }

  for (const orgId of orgs) {
    const [settings, sites, employees, payrolls, groups, owner] = await Promise.all([
      db.collection("hrSettings").doc(orgId).get(),
      db.collection("hrSites").where("organizationId", "==", orgId).get(),
      db.collection("employees").where("organizationId", "==", orgId).get(),
      db.collection("hrPayrolls").where("organizationId", "==", orgId).get(),
      db.collection("teamGroups").where("organizationId", "==", orgId).get(),
      db.collection("users").doc(orgId).get(),
    ])
    console.log(`\nCompany ${orgId}${owner.exists ? ` — owner ${owner.get("email")} (${owner.get("companyName") ?? owner.get("name") ?? ""})` : ""}`)
    console.log(`    HR settings: ${settings.exists ? `yes · business type ${settings.get("businessType") ?? "—"} · features [${((settings.get("features") as string[]) ?? []).join(", ")}]` : "NONE — HR not set up"}`)
    console.log(`    workplaces: ${sites.size} · employees: ${employees.size} · payrolls: ${payrolls.size}`)
    console.log(`    permission groups:`)
    for (const gr of groups.docs) {
      const p = (gr.get("permissions") as string[]) ?? []
      const hr = [...new Set(p.filter((x) => HR_PERMS[x]).map((x) => HR_PERMS[x]))]
      console.log(`      ${gr.id} «${gr.get("name") ?? ""}» — ${p.includes("*") ? "all" : `${p.length} perms`}${hr.length ? ` · HR: ${hr.join(", ")}` : ""}`)
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
