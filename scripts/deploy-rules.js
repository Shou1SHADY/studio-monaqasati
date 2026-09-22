// Deploys firestore.rules via the firebaserules REST API (firebase CLI does
// not work in this environment — see CLAUDE.md "Deploying firestore.rules").
//
//   node scripts/deploy-rules.js prod            — studio prod project, service-account creds from .env.local
//   node scripts/deploy-rules.js uat             — mdmaktech-uat: `gcloud auth print-access-token` when gcloud
//                                                  is installed, else the service account in .env.uat
//   node scripts/deploy-rules.js <prod|uat> --check
//                                                — READ-ONLY: which ruleset is live, when it was released,
//                                                  and whether it matches the file byte for byte
//
// Always `git fetch` and diff firestore.rules against origin/main BEFORE
// running this: deploying a stale local copy wipes other sessions' rules.
// Run --check first: if the live ruleset already matches git there is
// nothing to deploy, and if it matches neither git nor the previous commit,
// someone deployed rules that were never committed — find out before
// overwriting them.

const fs = require("fs")
const { execSync } = require("child_process")

const target = process.argv[2]
const checkOnly = process.argv.includes("--check")
if (target !== "prod" && target !== "uat") {
  console.error("usage: node scripts/deploy-rules.js <prod|uat> [--check]")
  process.exit(1)
}
// Only the chosen target's credentials are loaded — never both.
require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })

const source = fs.readFileSync("firestore.rules", "utf8")
const base = "https://firebaserules.googleapis.com/v1"

function hasGcloud() {
  try {
    execSync("command -v gcloud", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

async function serviceAccountToken() {
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

// A gcloud USER token needs a quota project named in a header; a service
// account of the project itself must not send one (it would need
// serviceusage.services.use on top, and 403s without it).
let quotaHeader = false

async function token() {
  if (target === "uat" && hasGcloud()) {
    quotaHeader = true
    return execSync("gcloud auth print-access-token").toString().trim()
  }
  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.error(`no credentials: ${target === "uat" ? "install gcloud (gcloud auth login) or provide .env.uat" : ".env.local"} with FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY`)
    process.exit(1)
  }
  return serviceAccountToken()
}

;(async () => {
  const project = target === "uat" ? "mdmaktech-uat" : process.env.FIREBASE_PROJECT_ID
  if (target === "uat" && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== project) {
    console.error(`refusing: .env.uat credentials are for "${process.env.FIREBASE_PROJECT_ID}", not ${project}`)
    process.exit(1)
  }
  if (target === "prod" && project === "mdmaktech-uat") {
    console.error("refusing: .env.local credentials are for UAT")
    process.exit(1)
  }
  const h = { Authorization: "Bearer " + (await token()), "Content-Type": "application/json" }
  if (quotaHeader) h["x-goog-user-project"] = project

  const live = async () => {
    const rel = await fetch(`${base}/projects/${project}/releases/cloud.firestore`, { headers: h }).then((r) => r.json())
    if (!rel.rulesetName) throw new Error(`no cloud.firestore release: ${JSON.stringify(rel).slice(0, 300)}`)
    const rs = await fetch(`${base}/${rel.rulesetName}`, { headers: h }).then((r) => r.json())
    return { id: rel.rulesetName.split("/").pop(), updated: rel.updateTime, content: rs.source.files[0].content }
  }

  // A ruleset is the same ruleset whatever its line endings: this working copy
  // keeps CRLF and git stores LF, so a raw byte comparison said the live rules
  // "match NO commit" every time and cried wolf about somebody deploying
  // uncommitted rules. Compare what Firestore actually reads.
  const lf = (text) => text.split("\r\n").join("\n")
  const same = (a, b) => lf(a) === lf(b)

  if (checkOnly) {
    const l = await live()
    // Which commit, if any, the live rules came from: the file's history,
    // newest first. A match means overwriting loses nothing that git does
    // not have; no match means someone deployed rules that were never
    // committed — compare before overwriting.
    let from = null
    if (!same(l.content, source)) {
      try {
        // Double quotes and no pipe: cmd.exe leaves single quotes in place and
        // splits the command at a "|", which turned this whole lookup into a
        // silent failure on Windows — and its catch reports the alarming
        // "someone deployed uncommitted rules".
        const commits = execSync('git log --format="%h %ad %s" --date=short -- firestore.rules', { maxBuffer: 1 << 24 }).toString().trim().split("\n")
        for (const line of commits) {
          const h = line.split(" ")[0]
          if (same(execSync(`git show ${h}:firestore.rules`, { maxBuffer: 1 << 26 }).toString(), l.content)) {
            from = line
            break
          }
        }
      } catch {
        /* not a git checkout */
      }
    }
    const verdict = same(l.content, source)
      ? "matches the file (nothing to deploy)"
      : from
        ? `is the file as committed in ${from} — deploying loses nothing`
        : "matches NO commit in the file's history — someone deployed uncommitted rules; compare before overwriting"
    console.log(`${target.toUpperCase()} project=${project} live ruleset ${l.id} released ${l.updated} (${l.content.length} chars; file ${source.length}) — ${verdict}`)
    return
  }

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

  const l = await live()
  console.log(`${target.toUpperCase()} live ruleset: ${l.id} | updated: ${l.updated} | matches the file: ${same(l.content, source)}`)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
