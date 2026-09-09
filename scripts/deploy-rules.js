// Deploys firestore.rules via the firebaserules REST API (firebase CLI does
// not work in this environment — see CLAUDE.md "Deploying firestore.rules").
//
//   node scripts/deploy-rules.js prod   — studio prod project, service-account creds from .env.local
//   node scripts/deploy-rules.js uat    — mdmaktech-uat, OAuth token from `gcloud auth print-access-token`
//
// Always `git fetch` and diff firestore.rules against origin/main BEFORE
// running this: deploying a stale local copy wipes other sessions' rules.

const fs = require("fs")
const { execSync } = require("child_process")
require("dotenv").config({ path: ".env.local" })

const target = process.argv[2]
if (target !== "prod" && target !== "uat") {
  console.error("usage: node scripts/deploy-rules.js <prod|uat>")
  process.exit(1)
}

const source = fs.readFileSync("firestore.rules", "utf8")
const base = "https://firebaserules.googleapis.com/v1"

async function token(project) {
  if (target === "uat") return execSync("gcloud auth print-access-token").toString().trim()
  const { GoogleAuth } = require("google-auth-library")
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  })
  return (await (await auth.getClient()).getAccessToken()).token
}

;(async () => {
  const project = target === "uat" ? "mdmaktech-uat" : process.env.FIREBASE_PROJECT_ID
  const h = { Authorization: "Bearer " + (await token(project)), "Content-Type": "application/json" }
  if (target === "uat") h["x-goog-user-project"] = project

  let res = await fetch(`${base}/projects/${project}/rulesets`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content: source }] } }),
  })
  let body = await res.json()
  if (!res.ok) {
    console.error("ruleset create failed", res.status, JSON.stringify(body).slice(0, 400))
    process.exit(1)
  }
  const rulesetName = body.name

  res = await fetch(`${base}/projects/${project}/releases/cloud.firestore`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({
      release: { name: `projects/${project}/releases/cloud.firestore`, rulesetName },
      updateMask: "rulesetName",
    }),
  })
  if (!res.ok) {
    console.error("release patch failed", res.status, JSON.stringify(await res.json()).slice(0, 400))
    process.exit(1)
  }

  const rel = await fetch(`${base}/projects/${project}/releases/cloud.firestore`, { headers: h }).then((r) => r.json())
  const live = await fetch(`${base}/${rel.rulesetName}`, { headers: h }).then((r) => r.json())
  console.log(
    `${target.toUpperCase()} live ruleset: ${rel.rulesetName.split("/").pop()} | updated: ${rel.updateTime} | matches git: ${live.source.files[0].content === source}`
  )
})()
