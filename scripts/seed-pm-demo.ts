/**
 * Seeds a PM 1.0 demo into ONE company so every Project Management screen has
 * something to show: a live villas project (BOQ by division, terms with an
 * advance, retention and delay damages, started five months ago) with approved
 * and waiting measurement sheets, inspections (one failed), a missing sample,
 * variations, a granted claim (programme R1) and a late one, a draft addendum,
 * a certified certificate past due and one awaiting approval, punch items, an
 * NCR, programme activities, Finance's outbox events — plus a handover file
 * waiting in "New projects".
 *
 * Usage (DRY RUN by default — prints what it would write, writes nothing):
 *   npx tsx scripts/seed-pm-demo.ts --owner uat.owner@mdmaktech.sa
 *   npx tsx scripts/seed-pm-demo.ts --owner uat.owner@mdmaktech.sa --apply
 *
 * UAT only (project mdmaktech-uat, fixed): it writes through Firestore's REST API
 * with your `gcloud auth print-access-token`, as scripts/deploy-rules.js does for
 * UAT. Each set of records is ONE atomic commit, created only if absent — re-running
 * is safe: the project and handover have fixed ids and are skipped if they exist.
 */

import { execSync } from "child_process"

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const OWNER_EMAIL = arg("--owner") || "uat.owner@mdmaktech.sa"
const APPLY = process.argv.includes("--apply")
const GCP_PROJECT = "mdmaktech-uat"
const token = execSync("gcloud auth print-access-token", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
const BASE = `https://firestore.googleapis.com/v1/projects/${GCP_PROJECT}/databases/(default)/documents`
const HEADERS = { Authorization: `Bearer ${token}`, "x-goog-user-project": GCP_PROJECT, "Content-Type": "application/json" }

// ── Firestore REST: values, reads, and one atomic commit ─────────────────────
class Ts {
  constructor(readonly iso: string) {}
}
const NOW = () => new Ts(new Date().toISOString())
type Json = null | boolean | number | string | Ts | Json[] | { [k: string]: Json }
function enc(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null }
  if (v instanceof Ts) return { timestampValue: v.iso }
  if (typeof v === "boolean") return { booleanValue: v }
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === "string") return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
}
const docName = (path: string) => `projects/${GCP_PROJECT}/databases/(default)/documents/${path}`
async function getDoc(path: string): Promise<{ fields?: Record<string, { stringValue?: string; integerValue?: string }>; updateTime?: string } | null> {
  const r = await fetch(`${BASE}/${path}`, { headers: HEADERS })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`read ${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
type Write = { path: string; data: { [k: string]: Json }; precondition?: { exists?: boolean; updateTime?: string } }
async function commit(writes: Write[]) {
  const body = { writes: writes.map((w) => ({ update: { name: docName(w.path), fields: (enc(w.data) as { mapValue: { fields: unknown } }).mapValue.fields }, currentDocument: w.precondition ?? { exists: false } })) }
  const r = await fetch(`${BASE}:commit`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`commit: ${r.status} ${await r.text()}`)
}
async function ownerOf(email: string): Promise<{ uid: string; orgId: string; name: string }> {
  const r = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } }, limit: 1 } }),
  })
  const rows = (await r.json()) as Array<{ document?: { name: string; fields: Record<string, { stringValue?: string }> } }>
  const docu = rows.find((x) => x.document)?.document
  if (!docu) throw new Error(`no user ${email} on UAT`)
  const uid = docu.name.split("/").pop() as string
  return { uid, orgId: docu.fields.organizationId?.stringValue || uid, name: docu.fields.name?.stringValue || email }
}

const PROJECT_ID = "pm-demo-yasmin"
const HANDOVER_ID = "pm-demo-handover-riyadh-school"
const DAY = 86_400_000
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
const d = (offset: number) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10)
const iso = (offset: number) => new Date(today.getTime() + offset * DAY + 9 * 3600_000).toISOString()
const r2 = (n: number) => Math.round(n * 100) / 100
const two = (n: number) => String(n).padStart(2, "0")

const TERMS = {
  payer: "owner",
  basis: "rem",
  advance: 0.1,
  advanceRecovery: "pro",
  retention: 0.05,
  retentionCap: 0.05,
  retentionRelease: "half",
  paymentDays: 30,
  consultantDays: 14,
  claimNoticeDays: 28,
  defectsDays: 365,
  damages: { on: true, weeklyRate: 0.005, cap: 0.1 },
}
const SNAP = { payer: TERMS.payer, advance: TERMS.advance, advanceRecovery: TERMS.advanceRecovery, retention: TERMS.retention, retentionCap: TERMS.retentionCap, paymentDays: TERMS.paymentDays, consultantDays: TERMS.consultantDays }

// The BOQ, by division — code, Arabic, English, unit, quantity, rate, executed, gate flags.
type Item = { id: string; code: string; div: string; divAr: string; divEn: string; ar: string; en: string; unit: string; qty: number; rate: number; exec: number; inspect?: boolean; wir?: string; sample?: boolean }
const ITEMS: Item[] = [
  { id: "i01", code: "02-01-01", div: "02", divAr: "أعمال ترابية", divEn: "Earthworks", ar: "حفر وردم للقواعد", en: "Excavation & backfill for footings", unit: "م³", qty: 1200, rate: 35, exec: 1200 },
  { id: "i02", code: "03-02-01", div: "03", divAr: "أعمال خرسانية", divEn: "Concrete works", ar: "خرسانة مسلحة للقواعد", en: "Reinforced concrete footings", unit: "م³", qty: 480, rate: 950, exec: 480 },
  { id: "i03", code: "03-03-01", div: "03", divAr: "أعمال خرسانية", divEn: "Concrete works", ar: "أعمدة وأسقف الفلل", en: "Villa columns & slabs", unit: "م³", qty: 900, rate: 1100, exec: 610, inspect: true, wir: "pass" },
  { id: "i04", code: "04-01-01", div: "04", divAr: "أعمال البناء", divEn: "Masonry", ar: "بناء بلوك 20 سم", en: "200 mm blockwork", unit: "م²", qty: 5200, rate: 85, exec: 1400 },
  { id: "i05", code: "07-01-01", div: "07", divAr: "العزل", divEn: "Waterproofing", ar: "عزل مائي للأسطح", en: "Roof waterproofing membrane", unit: "م²", qty: 2100, rate: 60, exec: 0, sample: true },
  { id: "i06", code: "09-01-01", div: "09", divAr: "التشطيبات", divEn: "Finishes", ar: "لياسة داخلية", en: "Internal plaster", unit: "م²", qty: 9800, rate: 38, exec: 900, inspect: true, wir: "fail" },
  { id: "i07", code: "15-01-01", div: "15", divAr: "الأعمال الميكانيكية", divEn: "Mechanical", ar: "تمديدات السباكة لكل فيلا", en: "Plumbing per villa", unit: "فيلا", qty: 5, rate: 185000, exec: 1 },
  { id: "i08", code: "16-01-01", div: "16", divAr: "الأعمال الكهربائية", divEn: "Electrical", ar: "التمديدات الكهربائية لكل فيلا", en: "Electrical per villa", unit: "فيلا", qty: 5, rate: 160000, exec: 1 },
  { id: "i09", code: "22-01-01", div: "22", divAr: "الأعمال الخارجية", divEn: "External works", ar: "الأسوار والتنسيق الخارجي", en: "Boundary walls & landscaping", unit: "مقطوعية", qty: 1, rate: 420000, exec: 0 },
]
const BUDGET = r2(ITEMS.reduce((a, i) => a + i.qty * i.rate, 0))
const itemById = new Map(ITEMS.map((i) => [i.id, i]))

// Certificates: 01 certified 45 days ago (due 30 days later — overdue), 02 awaiting internal approval.
const amounts = (gross: number, held: number, recovered: number) => {
  const recovery = r2(Math.min(gross * TERMS.advance, BUDGET * TERMS.advance - recovered))
  const retention = r2(Math.max(0, Math.min(gross * TERMS.retention, TERMS.retentionCap * BUDGET - held)))
  const vat = r2((gross - recovery) * 0.15)
  return { gross: r2(gross), recovery, retention, vat, net: r2(gross - recovery - retention + vat) }
}
const cert1Lines = [
  { itemId: "i01", qty: 1200 },
  { itemId: "i02", qty: 480 },
  { itemId: "i03", qty: 610 },
  { itemId: "i07", qty: 1 },
  { itemId: "i08", qty: 1 },
]
const cert2Lines = [
  { itemId: "i04", qty: 1400 },
  { itemId: "i06", qty: 900 },
]
const linesOf = (ls: Array<{ itemId: string; qty: number }>) => ls.map((l) => ({ itemId: l.itemId, code: itemById.get(l.itemId)!.code, qty: l.qty, rate: itemById.get(l.itemId)!.rate, amount: r2(l.qty * itemById.get(l.itemId)!.rate) }))
const gross1 = linesOf(cert1Lines).reduce((a, l) => a + l.amount, 0)
const gross2 = linesOf(cert2Lines).reduce((a, l) => a + l.amount, 0)
const a1 = amounts(gross1, 0, 0)
const a2 = amounts(gross2, a1.retention, a1.recovery)
const billed = new Map<string, number>([...cert1Lines, ...cert2Lines].map((l) => [l.itemId, l.qty]))

async function main() {
  const { uid, orgId, name } = await ownerOf(OWNER_EMAIL)
  console.log(`Target: ${GCP_PROJECT} · owner ${OWNER_EMAIL} (${uid}) · company ${orgId} · ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Project ${PROJECT_ID}: budget ${BUDGET.toLocaleString("en-US")} · certificate 01 net ${a1.net} · certificate 02 net ${a2.net}`)

  if (await getDoc(`projects/${PROJECT_ID}`)) console.log(`projects/${PROJECT_ID} exists — skipping the project`)
  else if (APPLY) await seedProject(orgId, uid, name)
  else console.log(`would write projects/${PROJECT_ID} with ${ITEMS.length} BOQ items, 4 sheets, 2 inspections, 1 sample, 2 variations, 2 claims, 1 addendum, 2 certificates, 2 punch items, 1 NCR, 5 activities, 2 events`)

  if (await getDoc(`pmHandovers/${HANDOVER_ID}`)) console.log(`pmHandovers/${HANDOVER_ID} exists — skipping the handover`)
  else if (APPLY) await seedHandover(orgId, uid, name)
  else console.log(`would write pmHandovers/${HANDOVER_ID} (waiting for ${OWNER_EMAIL})`)
  console.log(APPLY ? "Done." : "Dry run only — add --apply to write.")
}

async function seedProject(orgId: string, uid: string, name: string) {
  const year = today.getUTCFullYear()
  const counterPath = `mfgCounters/${orgId}__PJ__${year}`
  const counter = await getDoc(counterPath)
  const seq = (Number(counter?.fields?.last?.integerValue) || 0) + 1
  const no = `PJ-${year}/${String(seq).padStart(3, "0")}`
  const W: Write[] = [{ path: counterPath, data: { organizationId: orgId, type: "PJ", year, last: seq, updatedAt: NOW() }, precondition: counter?.updateTime ? { updateTime: counter.updateTime } : { exists: false } }]
  const put = (path: string, data: { [k: string]: Json }) => W.push({ path, data })
  const stamp = { organizationId: orgId, createdAt: NOW() }
  const by = { by: uid, byName: name }

  put(`projects/${PROJECT_ID}`, {
    organizationId: orgId,
    contractorId: uid,
    name: "مجمع الياسمين السكني — 5 فلل",
    description: "مشروع عرض لإدارة المشاريع 1.0",
    location: "الرياض — حي الياسمين",
    region: null,
    budget: BUDGET,
    status: "in_progress",
    projectType: "bld",
    clientName: "شركة الياسمين للتطوير العقاري",
    clientType: "company",
    enabledSections: ["contract", "procure", "receive", "store", "progress", "ipc", "collect", "docs"],
    rfqIds: [],
    contractNumber: "YSM-2026-014",
    projectManagerId: uid,
    projectManagerName: name,
    pm: {
      no,
      lifecycle: "live",
      kind: "bld",
      startOn: d(-150),
      startedAt: d(-150),
      durationDays: 365,
      signedOn: d(-170),
      terms: TERMS,
      original: TERMS,
      acceptances: {},
      sheetCount: 4,
      wirCount: 2,
      sampleCount: 1,
      voCount: 2,
      claimCount: 2,
      programmeRev: 1,
      addendaCount: 1,
      ipcCount: 2,
      punchCount: 2,
      ncrCount: 1,
      activityCount: 5,
      retentionHeld: r2(a1.retention + a2.retention),
      advanceRecovered: r2(a1.recovery + a2.recovery),
      cutPool: 0,
    },
    createdAt: NOW(),
    updatedAt: NOW(),
  })
  put((`projects/${PROJECT_ID}/members/${uid}`), { userId: uid, groupId: null, organizationId: orgId, addedBy: uid, pmRole: "pm", off: [], from: d(-150), to: null, createdAt: NOW() })

  for (const i of ITEMS) {
    put((`projects/${PROJECT_ID}/boqItems/${i.id}`), {
      itemNo: i.code,
      sheet: "BOQ",
      divisionNo: i.div,
      divisionNameAr: i.divAr,
      divisionNameEn: i.divEn,
      descriptionAr: i.ar,
      descriptionEn: i.en,
      unit: i.unit,
      quantity: i.qty,
      unitPrice: i.rate,
      totalPrice: r2(i.qty * i.rate),
      executedQuantity: i.exec,
      billedQuantity: billed.get(i.id) ?? 0,
      groupId: null,
      isEditable: true,
      ...(i.inspect ? { pmInspect: true, pmWir: i.wir ?? null } : {}),
      ...(i.sample ? { pmSample: true, pmSub: null } : {}),
      createdAt: NOW(),
    })
  }

  const sheet = (seq: number, day: number, status: string, lines: Array<[string, number]>) =>
    put((`projects/${PROJECT_ID}/pmSheets/${two(seq)}`), {
      seq,
      status,
      day: d(day),
      ...by,
      lines: lines.map(([itemId, qty]) => ({ itemId, code: itemById.get(itemId)!.code, qty, approved: status === "ok" ? qty : null })),
      note: null,
      okBy: status === "ok" ? uid : null,
      okByName: status === "ok" ? name : null,
      okAt: status === "ok" ? iso(day + 1) : null,
      self: status === "ok",
      ...stamp,
    })
  sheet(1, -120, "ok", [["i01", 1200], ["i02", 480]])
  sheet(2, -75, "ok", [["i03", 610], ["i07", 1], ["i08", 1]])
  sheet(3, -30, "ok", [["i04", 1400], ["i06", 900]])
  sheet(4, -3, "wait", [["i04", 300]])

  put((`projects/${PROJECT_ID}/pmInspections/01`), { seq: 1, itemId: "i03", code: "03-03-01", location: "الفيلا 2 — السقف الأول", party: "consultant", status: "pass", attempts: [{ n: 1, on: d(-80), result: "pass", note: null, ...by, rBy: uid, rByName: name, rAt: iso(-80) }], ...stamp })
  put((`projects/${PROJECT_ID}/pmInspections/02`), {
    seq: 2,
    itemId: "i06",
    code: "09-01-01",
    location: "الفيلا 1 — الدور الأرضي",
    party: "consultant",
    status: "fail",
    attempts: [{ n: 1, on: d(-10), result: "fail", note: "سماكة اللياسة أقل من المواصفة", ...by, rBy: uid, rByName: name, rAt: iso(-10) }],
    ...stamp,
  })
  put((`projects/${PROJECT_ID}/pmSubmittals/01`), { seq: 1, itemId: "i05", code: "07-01-01", supplier: "مصنع الجزيرة للعوازل", rev: 1, status: "rej", day: d(-25), ...by, reply: { on: d(-18), by: uid, byName: name, note: "السماكة 3 مم بدل 4 مم المطلوبة" }, ...stamp })

  put((`projects/${PROJECT_ID}/pmVariations/01`), { seq: 1, title: "إضافة غرفة خادمة للفيلا 5", source: "client", instructionNo: "CI-07", day: d(-60), value: 85000, cost: 62000, executedPct: 40, status: "appr", ...by, decision: { on: d(-50), by: uid, byName: name, ref: "APP-VO-01", reason: null }, ...stamp })
  put((`projects/${PROJECT_ID}/pmVariations/02`), { seq: 2, title: "تغيير نوع البلاط الخارجي", source: "cons", instructionNo: "SI-12", day: d(-12), value: 46000, cost: 35000, executedPct: 0, status: "wait", ...by, decision: null, ...stamp })

  put((`projects/${PROJECT_ID}/pmClaims/01`), {
    seq: 1,
    kind: "time",
    cause: "تأخر الاستشاري في اعتماد المخططات الإنشائية",
    eventOn: d(-110),
    daysAsked: 45,
    amountAsked: 0,
    status: "part",
    ...by,
    noticeOn: d(-100),
    submittedOn: d(-90),
    response: { on: d(-70), by: uid, byName: name, days: 30, amount: 0 },
    revision: 1,
    ...stamp,
  })
  put((`projects/${PROJECT_ID}/pmClaims/02`), { seq: 2, kind: "time", cause: "توقف العمل بسبب إغلاق الطريق من البلدية", eventOn: d(-35), daysAsked: 10, amountAsked: 0, status: "draft", ...by, noticeOn: null, submittedOn: null, response: null, revision: null, ...stamp })

  put((`projects/${PROJECT_ID}/pmAddenda/01`), { seq: 1, status: "draft", day: d(-5), ...by, reason: "client", reasonText: null, changes: [{ key: "paymentDays", from: 30, to: 45 }], note: "طلب المالك تمديد مهلة الدفع", ...stamp })

  put((`projects/${PROJECT_ID}/pmCertificates/01`), {
    seq: 1,
    status: "appr",
    lines: linesOf(cert1Lines),
    cutsIncluded: 0,
    terms: SNAP,
    contractValue: BUDGET,
    ...a1,
    prep: uid,
    prepName: name,
    prepOn: d(-60),
    appr: "demo-approver",
    apprName: "م. سامي القحطاني",
    apprOn: d(-55),
    selfApp: false,
    certified: a1.gross,
    cut: 0,
    cutReason: null,
    consultantRef: "CONS-IPC-01",
    certOn: d(-45),
    certBy: uid,
    certByName: name,
    dueOn: d(-15),
    submitted: a1,
    ...stamp,
  })
  put((`projects/${PROJECT_ID}/pmCertificates/02`), {
    seq: 2,
    status: "int",
    lines: linesOf(cert2Lines),
    cutsIncluded: 0,
    terms: SNAP,
    contractValue: BUDGET,
    ...a2,
    prep: uid,
    prepName: name,
    prepOn: d(-2),
    appr: null,
    apprName: null,
    apprOn: null,
    selfApp: false,
    certified: null,
    cut: null,
    cutReason: null,
    consultantRef: null,
    certOn: null,
    certBy: null,
    certByName: null,
    dueOn: null,
    submitted: null,
    ...stamp,
  })

  put((`projects/${PROJECT_ID}/pmPunch/01`), { seq: 1, what: "تشققات شعرية في لياسة الممر", location: "الفيلا 1 — الممر الرئيسي", severity: "b", source: "cons", status: "open", day: d(-8), ...by, itemId: "i06", fix: null, conf: null, ...stamp })
  put((`projects/${PROJECT_ID}/pmPunch/02`), { seq: 2, what: "ميول تصريف السطح غير كافية", location: "الفيلا 2 — السطح", severity: "a", source: "int", status: "fix", day: d(-20), ...by, itemId: "i05", fix: { on: d(-4), by: uid, byName: name, note: "أُعيدت الميول" }, conf: null, ...stamp })

  put((`projects/${PROJECT_ID}/pmNcrs/01`), { seq: 1, itemId: "i06", code: "09-01-01", severity: "a", root: "لم تُستخدم أدلة السماكة قبل اللياسة", cost: 12500, status: "open", day: d(-9), ...by, plan: null, accepted: null, ...stamp })

  const act = (seq: number, nameAr: string, from: number, to: number, itemIds: string[], pred: number | null) =>
    put((`projects/${PROJECT_ID}/pmActivities/${two(seq)}`), { seq, name: nameAr, from: d(from), to: d(to), itemIds, pred: pred ? two(pred) : null, by: uid, byName: name, at: iso(-140), ...stamp })
  act(1, "أعمال الحفر والقواعد", -150, -100, ["i01", "i02"], null)
  act(2, "هيكل الفلل الخرساني", -100, -20, ["i03"], 1)
  act(3, "بناء البلوك", -40, 40, ["i04"], 2)
  act(4, "اللياسة والتشطيبات", 0, 120, ["i06"], 3)
  act(5, "الكهرباء والسباكة", -60, 150, ["i07", "i08"], 2)

  const ev = (key: string, kind: string, amount: number, params: Record<string, string | number>, at: string) =>
    put((`pmEvents/${key.replace(/\//g, "_")}`), { key, kind, organizationId: orgId, projectId: PROJECT_ID, projectNo: no, amount, params, by: uid, at })
  ev(`prj:ADV:${no}`, "ADV", r2(BUDGET * TERMS.advance), { rate: TERMS.advance, recovery: TERMS.advanceRecovery, contractValue: BUDGET }, iso(-150))
  ev(`prj:IPC:${no}:01`, "IPC", a1.gross, { certificate: "01", gross: a1.gross, recovery: a1.recovery, retention: a1.retention, vat: a1.vat, net: a1.net, due: d(-15) }, iso(-45))

  await commit(W)
  console.log(`wrote projects/${PROJECT_ID} as ${no} (${W.length} documents, one commit)`)
}

async function seedHandover(orgId: string, uid: string, name: string) {
  await commit([{ path: `pmHandovers/${HANDOVER_ID}`, data: {
    organizationId: orgId,
    status: "wait",
    to: uid,
    toName: name,
    opportunityId: "demo-opportunity-riyadh-school",
    contactId: null,
    title: "مدرسة الرياض الأهلية — المبنى الجديد",
    clientName: "مدارس الرياض الأهلية",
    clientType: "company",
    kind: "bld",
    location: "الرياض — حي النرجس",
    contractNumber: "RYS-2026-031",
    value: 18500000,
    durationDays: 540,
    signedOn: d(-6),
    startOn: d(14),
    advance: 0.1,
    retention: 0.05,
    note: "ملف عرض — يُقبل من «مشاريع جديدة»",
    requestedBy: uid,
    requestedByName: name,
    createdAt: iso(-2),
  } }])
  console.log(`wrote pmHandovers/${HANDOVER_ID}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
