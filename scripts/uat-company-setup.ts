/**
 * Small, explicit set-up steps on ONE UAT company before it is shown to a client. Each step is named on the
 * command line; nothing else changes. DRY RUN by default — prints what it would do; `--apply` writes.
 * UAT only (refuses any project but mdmaktech-uat).
 *
 *   npx tsx scripts/uat-company-setup.ts --env .env.uat --owner <email> \
 *     [--features hire,perf,train,punch,gov,mudad]      turn HR's optional modules on (logged in the settings' log)
 *     [--revoke <groupKey>:<permission>]               take one permission off the company's group {orgId}_{groupKey}
 *     [--link-site <hrSiteId>:<projectId>]             tie an HR workplace to the company's project
 *     [--apply]
 */

import { config } from "dotenv"
import { resolve } from "path"

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? (process.argv[i + 1] ?? null) : null
}
const ENV_FILE = arg("--env") || ".env.uat"
config({ path: resolve(process.cwd(), ENV_FILE) })

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { HR_FEATURES } from "@/lib/hr/settings"

const UAT_PROJECT = "mdmaktech-uat"
const APPLY = process.argv.includes("--apply")

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  console.log(`Env file: ${ENV_FILE}\nFirebase project: ${projectId}${APPLY ? "" : "   (dry run — nothing is written)"}`)
  if (projectId !== UAT_PROJECT) throw new Error(`refusing: only ${UAT_PROJECT}`)
  initializeApp({ credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") }) })
  const db = getFirestore()
  const email = arg("--owner")
  if (!email) throw new Error("--owner <email> is required")
  const owners = await db.collection("users").where("email", "==", email).limit(1).get()
  if (owners.empty) throw new Error(`no user ${email}`)
  const owner = owners.docs[0]
  const orgId = String(owner.get("organizationId") || owner.id)
  if (orgId !== owner.id) throw new Error(`${email} is not the company's owner`)
  console.log(`Company ${orgId} (owner ${email})\n`)
  const at = new Date().toISOString()
  const by = { by: owner.id, byName: String(owner.get("name") ?? email) }

  const features = arg("--features")
  if (features) {
    const want = features.split(",").map((f) => f.trim()).filter(Boolean)
    const bad = want.filter((f) => !(HR_FEATURES as readonly string[]).includes(f))
    if (bad.length) throw new Error(`unknown feature(s): ${bad.join(", ")} — known: ${HR_FEATURES.join(", ")}`)
    const ref = db.doc(`hrSettings/${orgId}`)
    const s = await ref.get()
    if (!s.exists) throw new Error(`hrSettings/${orgId} does not exist — set HR up first`)
    const before = ((s.get("features") as string[]) ?? []).slice().sort()
    const after = [...new Set([...before, ...want])].sort()
    console.log(`features: [${before.join(", ")}] → [${after.join(", ")}]`)
    if (APPLY && after.join() !== before.join())
      await ref.update({ features: after, log: FieldValue.arrayUnion({ at, ...by, field: "features", from: before.join(", "), to: after.join(", ") }), updatedAt: FieldValue.serverTimestamp() })
  }

  const revoke = arg("--revoke")
  if (revoke) {
    const [key, permission] = revoke.split(":")
    if (!key || !permission) throw new Error("--revoke <groupKey>:<permission>")
    const ref = db.doc(`teamGroups/${orgId}_${key}`)
    const g = await ref.get()
    if (!g.exists || g.get("organizationId") !== orgId) throw new Error(`no group ${orgId}_${key} in this company`)
    const has = ((g.get("permissions") as string[]) ?? []).includes(permission)
    const members = await db.collection("users").where("organizationId", "==", orgId).where("defaultGroupId", "==", ref.id).get()
    console.log(`revoke ${permission} from «${g.get("name")}» (${ref.id}) — ${has ? "held" : "not held, nothing to do"} · members: ${members.docs.map((m) => m.get("email")).join(", ") || "none"}`)
    if (APPLY && has) await ref.update({ permissions: FieldValue.arrayRemove(permission), updatedAt: FieldValue.serverTimestamp() })
  }

  const link = arg("--link-site")
  if (link) {
    const [siteId, project] = link.split(":")
    const site = await db.doc(`hrSites/${siteId}`).get()
    const proj = await db.doc(`projects/${project}`).get()
    if (!site.exists || site.get("organizationId") !== orgId) throw new Error(`no HR workplace ${siteId} in this company`)
    if (!proj.exists || proj.get("organizationId") !== orgId) throw new Error(`no project ${project} in this company`)
    if (site.get("type") !== "project") throw new Error(`${siteId} is a ${site.get("type")}, not a project workplace`)
    console.log(`link «${site.get("name")}» → project «${proj.get("name")}» (${project}) · was ${site.get("projectId") ?? "none"}`)
    if (APPLY) await site.ref.update({ projectId: project, updatedAt: FieldValue.serverTimestamp() })
  }
  console.log(APPLY ? "\nDone." : "\nDry run — add --apply to write.")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
