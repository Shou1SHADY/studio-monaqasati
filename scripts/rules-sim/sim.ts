// Runs firestore.rules for real (Google's rules-test API) against a case, using the live UAT documents the rules read.
// UAT ONLY: documents come from mdmaktech-uat through the signed-in gcloud user. Nothing is written anywhere.

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { openUatDb, UAT_PROJECT } from "../lib/uat-db"

export type Method = "get" | "list" | "create" | "update" | "delete"
type Data = Record<string, unknown>

export interface RuleCase {
  name: string
  uid: string | null
  method: Method
  /** Document path without the databases prefix, e.g. purchaseOrders/abc */
  path: string
  /** The stored document (update, delete, get). */
  before?: Data
  /** The document after the write (create, update). */
  after?: Data
  /** Documents the rules may read, replacing what UAT holds (null = does not exist). */
  overrides?: Record<string, Data | null>
  expect: "ALLOW" | "DENY"
}

export interface RuleResult {
  name: string
  expected: "ALLOW" | "DENY"
  got: "ALLOW" | "DENY"
  ok: boolean
  reads: string[]
  detail: string
}

const ROOT = "/databases/(default)/documents/"
const rulesSource = () => fs.readFileSync(process.env.RULES_FILE ?? path.join(process.cwd(), "firestore.rules"), "utf8")
const token = () => execSync("gcloud auth print-access-token", { encoding: "utf8", env: process.env }).trim()
const { db } = openUatDb()

const plain = (v: unknown): unknown => {
  if (v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.map(plain)
  const o = v as { toDate?: () => Date }
  if (typeof o.toDate === "function") return o.toDate().toISOString()
  return Object.fromEntries(Object.entries(v as Data).map(([k, x]) => [k, plain(x)]))
}

const liveCache = new Map<string, Data | null>()
async function live(p: string): Promise<Data | null> {
  if (!liveCache.has(p)) {
    const snap = await db.doc(p).get()
    liveCache.set(p, snap.exists ? (plain(snap.data()) as Data) : null)
  }
  return liveCache.get(p) ?? null
}

const decode = (p: string) => decodeURIComponent(p).replace("/databases/(default)/documents/", "")

interface TestResult {
  state: string
  debugMessages?: string[]
  functionCalls?: Array<{ function: string; args: string[] }>
}

async function call(testCase: unknown, mocks: unknown[]): Promise<TestResult> {
  const body = JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rulesSource() }] }, testSuite: { testCases: [{ ...(testCase as object), functionMocks: mocks }] } })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${UAT_PROJECT}:test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": UAT_PROJECT, "Content-Type": "application/json" },
      body,
    })
    const json = (await res.json()) as { testResults?: TestResult[]; error?: { message: string } }
    if (json.testResults) return json.testResults[0]
    last = json.error?.message ?? last
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
  }
  throw new Error(last)
}

export async function simulate(c: RuleCase): Promise<RuleResult> {
  const known = new Map<string, Data | null>()
  const testCase = {
    expectation: "ALLOW",
    request: { auth: c.uid ? { uid: c.uid, token: {} } : null, path: ROOT + c.path, method: c.method, ...(c.after ? { resource: { data: c.after } } : {}) },
    ...(c.before ? { resource: { data: c.before } } : {}),
  }
  for (let round = 0; round < 12; round++) {
    const mocks = [...known].flatMap(([p, d]) => [
      { function: "exists", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
      { function: "get", args: [{ exactValue: ROOT + p }], result: d === null ? { undefined: {} } : { value: { data: d } } },
    ])
    const r = await call(testCase, mocks)
    const wanted = [...new Set((r.functionCalls ?? []).map((f) => decode(f.args[0])))].filter((p) => !known.has(p))
    if (wanted.length === 0 || r.state === "SUCCESS") {
      const got = r.state === "SUCCESS" ? "ALLOW" : "DENY"
      return { name: c.name, expected: c.expect, got, ok: got === c.expect, reads: [...known.keys()], detail: (r.debugMessages ?? []).join(" | ").slice(0, 300) }
    }
    for (const p of wanted) known.set(p, c.overrides && p in c.overrides ? c.overrides[p] : await live(p))
  }
  return { name: c.name, expected: c.expect, got: "DENY", ok: false, reads: [...known.keys()], detail: "did not settle in 12 rounds" }
}

export async function runAll(cases: RuleCase[]): Promise<number> {
  let bad = 0
  for (const c of cases) {
    const r = await simulate(c)
    if (!r.ok) bad++
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  (expected ${r.expected}, got ${r.got})${r.ok ? "" : "  " + r.detail}`)
  }
  console.log(`\n${cases.length - bad}/${cases.length} as expected`)
  return bad
}
