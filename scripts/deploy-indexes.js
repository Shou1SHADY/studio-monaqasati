#!/usr/bin/env node
// Creates the composite indexes of firestore.indexes.json that the project
// does not have yet — `firebase deploy` does not work in this environment.
//
//   node scripts/deploy-indexes.js prod [--check]   service-account creds from .env.local
//   node scripts/deploy-indexes.js uat  [--check]   gcloud token, else .env.uat
//
// Idempotent: an index that already exists (same fields, same scope) is
// skipped and never recreated; nothing is ever deleted. `--check` only lists.
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const target = process.argv[2]
const checkOnly = process.argv.includes("--check")
if (!["prod", "uat"].includes(target)) {
  console.error("usage: node scripts/deploy-indexes.js <prod|uat> [--check]")
  process.exit(1)
}
require("dotenv").config({ path: path.join(__dirname, "..", target === "uat" ? ".env.uat" : ".env.local") })

function hasGcloud() {
  try { execSync("gcloud --version", { stdio: "ignore" }); return true } catch { return false }
}
async function serviceAccountToken() {
  const { GoogleAuth } = require("google-auth-library")
  const auth = new GoogleAuth({
    credentials: { client_email: process.env.FIREBASE_CLIENT_EMAIL, private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  })
  return (await (await auth.getClient()).getAccessToken()).token
}
let quotaHeader = false
async function token() {
  if (target === "uat" && hasGcloud()) { quotaHeader = true; return execSync("gcloud auth print-access-token").toString().trim() }
  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.error(`no credentials for ${target}`); process.exit(1)
  }
  return serviceAccountToken()
}

const key = (ix) => `${ix.queryScope}|${ix.fields.filter((f) => f.fieldPath !== "__name__").map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(",")}`

;(async () => {
  const project = target === "uat" ? "mdmaktech-uat" : process.env.FIREBASE_PROJECT_ID
  const h = { Authorization: "Bearer " + (await token()), "Content-Type": "application/json" }
  if (quotaHeader) h["x-goog-user-project"] = project
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups`
  const wanted = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "firestore.indexes.json"), "utf8")).indexes || []

  const res = await fetch(`${base}/-/indexes`, { headers: h })
  if (!res.ok) { console.error(`list failed ${res.status}: ${await res.text()}`); process.exit(1) }
  const live = ((await res.json()).indexes || []).map((ix) => ({
    group: ix.name.split("/collectionGroups/")[1].split("/")[0],
    k: key({ queryScope: ix.queryScope, fields: ix.fields }),
    state: ix.state,
  }))
  const have = new Set(live.map((l) => `${l.group}|${l.k}`))

  let created = 0, skipped = 0
  for (const ix of wanted) {
    const id = `${ix.collectionGroup}|${key(ix)}`
    if (have.has(id)) { skipped++; continue }
    console.log(`${checkOnly ? "missing" : "creating"}: ${ix.collectionGroup} [${ix.fields.map((f) => `${f.fieldPath} ${f.order || f.arrayConfig}`).join(", ")}]`)
    if (checkOnly) continue
    const r = await fetch(`${base}/${ix.collectionGroup}/indexes`, { method: "POST", headers: h, body: JSON.stringify({ queryScope: ix.queryScope, fields: ix.fields }) })
    if (!r.ok) { console.error(`  failed ${r.status}: ${await r.text()}`); process.exit(1) }
    created++
  }
  console.log(`${target.toUpperCase()} project=${project}: ${live.length} live, ${skipped} of ${wanted.length} already present, ${created} created${checkOnly ? " (check only)" : ""}. New indexes build in the background — Firestore reports READY in a few minutes.`)
})()
