// Gets the UAT demo company ready for the test guide of 5 Oct 2026 (to-dos, the document
// thread, the equipment desk). Two gaps only, both on the demo company "البنيان":
//   1. its supply-chain group predates the warehouse permissions — it gets the two the seeded
//      group (src/lib/permissions.ts) already holds, so its member can run the equipment desk;
//   2. its live PM demo project has "Plant on site" (eqp) switched off — it is switched on,
//      with the same log entry the Manage sections dialog writes.
//
//   node scripts/prepare-uat-test-data.js            — DRY RUN: says what it would change
//   node scripts/prepare-uat-test-data.js --apply    — writes
//
// UAT ONLY (project mdmaktech-uat, fixed). Uses the signed-in gcloud user. Idempotent: a group that
// already holds the permissions, or a project that already has the section, is left alone.

const { execSync } = require("child_process")
const { Firestore, FieldValue } = require("@google-cloud/firestore")
const { OAuth2Client } = require("google-auth-library")

const apply = process.argv.includes("--apply")
const GROUP = "uilut3A3HnV13RiZXYqd3KgeNCH3_supply_chain"
const PROJECT = "pm-demo-yasmin"
const OWNER = "uilut3A3HnV13RiZXYqd3KgeNCH3"
const WANT = ["warehouses.manage", "warehouses.receive"]

const authClient = new OAuth2Client()
authClient.setCredentials({ access_token: execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim() })
const db = new Firestore({ projectId: "mdmaktech-uat", authClient })

;(async () => {
  console.log(`UAT (mdmaktech-uat) — ${apply ? "APPLY" : "dry run"}`)

  const groupRef = db.collection("teamGroups").doc(GROUP)
  const group = await groupRef.get()
  if (!group.exists) throw new Error(`group ${GROUP} not found`)
  const have = group.data().permissions || []
  const missing = WANT.filter((p) => !have.includes(p))
  console.log(missing.length ? `group ${GROUP}: adds ${missing.join(", ")}` : `group ${GROUP}: already holds them`)
  if (apply && missing.length) await groupRef.update({ permissions: FieldValue.arrayUnion(...missing) })

  const projectRef = db.collection("projects").doc(PROJECT)
  const project = await projectRef.get()
  if (!project.exists) throw new Error(`project ${PROJECT} not found`)
  const p = project.data()
  if (p.organizationId !== OWNER) throw new Error(`project ${PROJECT} belongs to ${p.organizationId}, not the demo company`)
  const sections = p.enabledSections || []
  if (sections.includes("eqp")) {
    console.log(`project ${PROJECT}: "Plant on site" is already on`)
  } else {
    console.log(`project ${PROJECT}: switches "Plant on site" (eqp) on`)
    if (apply) {
      const owner = await db.collection("users").doc(OWNER).get()
      const entry = { on: ["eqp"], off: [], reason: null, reasonText: null, by: OWNER, byName: (owner.data() || {}).name || null, at: new Date().toISOString() }
      await projectRef.update({
        enabledSections: FieldValue.arrayUnion("eqp"),
        "pm.secLog": FieldValue.arrayUnion(entry),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  }
  if (!apply) console.log("nothing written — run again with --apply")
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
