// Procurement 2.0 (PRD §14) — policies. `procurementSettings/{orgId}` is read through `resolvePolicies`, so a missing field
// already falls back to the PRD's value and NOTHING here is needed for the app to work. The settings form writes the WHOLE
// resolved set on every save, though, so a company that ever saved it carries values nobody chose: the old default of 2 days for
// the supplier's acceptance window, the old shared reply window, the offer seal. This script reports them and, only with a flag,
// changes them:
//
//   (no flag)             DRY RUN of the report: what each document holds that 2.0 changed
//   --split-reply         `replyWindowDays` becomes `inventoryReplyDays` and `workshopReplyDays` (same number, both) where they are absent
//   --acceptance-default  removes `supplierAcceptanceDays` where it is 2 (the old default — it then follows the PRD's 1 day); a 2 the owner
//                         typed on purpose is indistinguishable, so read the list first and use --only to name the companies
//   --drop-seal           removes `sealOffersUntilDeadline` — ONLY after the release that stops reading it is live, or a stored `true` keeps hiding prices
//   --only <orgId> ...    restrict to the named companies
//   --apply               write (without it nothing is written)
//
//   node scripts/migrate-proc-policies.js uat
//   node scripts/migrate-proc-policies.js uat --split-reply --apply
//   node scripts/migrate-proc-policies.js prod --acceptance-default --only <orgId>    — dry run
//
// Idempotent. Every other value is left as it is. Credentials: `.env.uat` / `.env.local`.

/**
 * The plan for one document, pure. `data`: the stored fields. Returns `notes` (what the report says), `set` (fields to write)
 * and `unset` (fields to remove) for the flags asked.
 */
function planDoc(data, flags) {
  const notes = []
  const set = {}
  const unset = []
  const has = (k) => data[k] !== undefined && data[k] !== null
  if (has("sealOffersUntilDeadline")) {
    notes.push(`holds sealOffersUntilDeadline=${data.sealOffersUntilDeadline}`)
    if (flags.dropSeal) unset.push("sealOffersUntilDeadline")
  }
  if (has("replyWindowDays") && (!has("inventoryReplyDays") || !has("workshopReplyDays"))) {
    notes.push(`one reply window (${data.replyWindowDays}) for Inventory and the workshop`)
    if (flags.splitReply) {
      if (!has("inventoryReplyDays")) set.inventoryReplyDays = data.replyWindowDays
      if (!has("workshopReplyDays")) set.workshopReplyDays = data.replyWindowDays
    }
  }
  if (data.supplierAcceptanceDays === 2) {
    notes.push("supplierAcceptanceDays=2 (the old default; the PRD's is 1)")
    if (flags.acceptanceDefault) unset.push("supplierAcceptanceDays")
  }
  return { notes, set, unset }
}

module.exports = { planDoc }

async function main() {
  const argv = process.argv.slice(2)
  const target = argv[0]
  if (target !== "uat" && target !== "prod") {
    console.error("usage: node scripts/migrate-proc-policies.js <uat|prod> [--split-reply] [--acceptance-default] [--drop-seal] [--only <orgId> ...] [--apply]")
    process.exit(1)
  }
  const apply = argv.includes("--apply")
  const flags = { splitReply: argv.includes("--split-reply"), acceptanceDefault: argv.includes("--acceptance-default"), dropSeal: argv.includes("--drop-seal") }
  const only = argv.flatMap((a, i) => (a === "--only" ? [argv[i + 1]] : []))
  require("dotenv").config({ path: target === "uat" ? ".env.uat" : ".env.local" })
  const { initializeApp, cert } = require("firebase-admin/app")
  const { getFirestore, FieldValue } = require("firebase-admin/firestore")

  const projectId = process.env.FIREBASE_PROJECT_ID
  if (target === "uat" && projectId !== "mdmaktech-uat") {
    console.error(`refusing: asked for uat but the credentials are for "${projectId}"`)
    process.exit(1)
  }
  if (target === "prod" && projectId === "mdmaktech-uat") {
    console.error("refusing: asked for prod but the credentials are for UAT")
    process.exit(1)
  }
  initializeApp({
    credential: cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }),
  })
  const db = getFirestore()

  console.log(`${target.toUpperCase()} · project ${projectId} · ${apply ? "APPLYING" : "dry run — nothing will be written"}`)
  console.log(`flags: ${Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(", ") || "none (report only)"}\n`)
  const snap = await db.collection("procurementSettings").get()
  const plans = []
  for (const d of snap.docs) {
    if (only.length && !only.includes(d.id)) continue
    const plan = planDoc(d.data(), flags)
    if (plan.notes.length) plans.push({ id: d.id, ...plan })
  }
  for (const p of plans) {
    console.log(`${p.id}: ${p.notes.join(" · ")}`)
    if (Object.keys(p.set).length) console.log(`    would set ${JSON.stringify(p.set)}`)
    if (p.unset.length) console.log(`    would remove ${p.unset.join(", ")}`)
  }
  console.log(`\n${snap.size} documents read, ${plans.length} with something 2.0 changed.`)
  const writes = plans.filter((p) => Object.keys(p.set).length || p.unset.length)
  if (!apply) {
    console.log(writes.length ? "Dry run. Re-run with --apply to write." : "Nothing to write with these flags.")
    return
  }
  let batch = db.batch()
  let n = 0
  for (const p of writes) {
    const patch = { ...p.set }
    for (const k of p.unset) patch[k] = FieldValue.delete()
    batch.update(db.collection("procurementSettings").doc(p.id), patch)
    if (++n % 400 === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  await batch.commit()
  console.log(`\nDone: ${writes.length} document(s) changed.`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
