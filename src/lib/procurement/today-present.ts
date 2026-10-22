// How a Today row's parameters read on screen: the document numbers in the reader's script, the days as dates, the coded facts (a
// finance hold's reason, whose move it is, which module receives) as their words. Pure: the translator comes in as a function.

import { displayNeedRef, displayDocNumber } from "./format"
import { sarLtr } from "../riyal"

export type Params = Record<string, string | number>

/** `YYYY-MM-DD` → a short day in the locale's script, Western digits in both. */
export function fmtDay(day: string | null | undefined, locale: string): string {
  if (!day) return ""
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

/** Numbers stay numbers — the ICU `{x, number}` and plural forms need them. */
export function presentParams(p: Params, locale: string, words: (key: string) => string): Params {
  const out: Params = { ...p }
  for (const k of ["number", "receipt", "invoice", "advance"]) if (typeof out[k] === "string") out[k] = displayDocNumber(out[k] as string, locale)
  // A project's request reads as the project wrote it («ط.م 03», PUR-01); an RFQ's number passes through.
  for (const k of ["ref"]) if (typeof out[k] === "string") out[k] = displayNeedRef(out[k] as string, locale)
  for (const k of ["date", "promised", "ready", "fromDay", "toDay"]) if (typeof out[k] === "string" && out[k]) out[k] = fmtDay(out[k] as string, locale)
  if (typeof out.holdReason === "string") out.reason = words(`rfqpo.po.hold.reason.${out.holdReason}`)
  if (typeof out.holdOwner === "string") out.owner = words(`rfqpo.po.hold.owner.${out.holdOwner}`)
  for (const k of ["over", "lowest"]) if (typeof out[k] === "number") out[k] = sarLtr(Math.round(out[k] as number).toLocaleString("en-US"))
  return out
}
