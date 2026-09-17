// The amount in words on a quotation (Sales PRD QC-14) — generated from the
// total, never typed. Arabic follows the counting rules a Saudi commercial
// document uses ("فقط … ريالاً لا غير"): the counted noun changes with the
// number (ريالات for 3–10, ريالاً for 11–99, ريال after hundreds and thousands),
// and the dual drops its ن in construct ("ألفا ريال").
//
// 150,765.00 → "فقط مائة وخمسون ألفاً وسبعمائة وخمسة وستون ريالاً لا غير".
// Ported from the reference prototype so the document reads the same.

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"]
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"]
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"]

function arabicBelowThousand(x: number): string {
  const h = Math.floor(x / 100)
  const r = x % 100
  const parts: string[] = []
  if (h) parts.push(HUNDREDS[h])
  if (r) {
    if (r < 20) parts.push(ONES[r])
    else {
      const o = r % 10
      const t = Math.floor(r / 10)
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t])
    }
  }
  return parts.join(" و")
}

/** A counted group (thousands, millions). `final` = nothing follows it, so the
 * dual stands in construct before "ريال" and 11–99 take the genitive. */
function arabicGroup(k: number, one: string, two: string, twoConstruct: string, plural: string, accusative: string, genitive: string, final: boolean): string {
  if (k === 1) return one
  if (k === 2) return final ? twoConstruct : two
  const r = k % 100
  if (r >= 3 && r <= 10) return `${arabicBelowThousand(k)} ${plural}`
  if (r >= 11 && r <= 99) return `${arabicBelowThousand(k)} ${final ? genitive : accusative}`
  return `${arabicBelowThousand(k)} ${genitive}`
}

export function amountInArabicWords(amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100
  const riyals = Math.floor(n)
  const halalas = Math.round((n - riyals) * 100)
  const millions = Math.floor(riyals / 1e6)
  const thousands = Math.floor((riyals % 1e6) / 1000)
  const units = riyals % 1000
  const parts: string[] = []
  if (millions) parts.push(arabicGroup(millions, "مليون", "مليونان", "مليونا", "ملايين", "مليوناً", "مليون", !thousands && !units))
  if (thousands) parts.push(arabicGroup(thousands, "ألف", "ألفان", "ألفا", "آلاف", "ألفاً", "ألف", !units))
  if (units) parts.push(arabicBelowThousand(units))
  let text = parts.join(" و")
  const last = units % 100
  if (riyals === 1) text = "ريال واحد"
  else if (riyals === 2) text = "ريالان"
  else if (riyals) text += ` ${units && last >= 3 && last <= 10 ? "ريالات" : units && last >= 11 && last <= 99 ? "ريالاً" : "ريال"}`
  let out = `فقط ${riyals ? text : ""}`
  if (halalas) out += `${riyals ? " و" : ""}${arabicBelowThousand(halalas)} هللة`
  return `${out} لا غير`
}

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

function englishBelowThousand(x: number): string {
  const h = Math.floor(x / 100)
  const r = x % 100
  const parts: string[] = []
  if (h) parts.push(`${EN_ONES[h]} hundred`)
  if (r) parts.push(r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ""))
  return parts.join(" and ")
}

export function amountInEnglishWords(amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100
  const riyals = Math.floor(n)
  const halalas = Math.round((n - riyals) * 100)
  const millions = Math.floor(riyals / 1e6)
  const thousands = Math.floor((riyals % 1e6) / 1000)
  const units = riyals % 1000
  const parts: string[] = []
  if (millions) parts.push(`${englishBelowThousand(millions)} million`)
  if (thousands) parts.push(`${englishBelowThousand(thousands)} thousand`)
  if (units) parts.push((millions || thousands) && units < 100 ? `and ${englishBelowThousand(units)}` : englishBelowThousand(units))
  let text = `${parts.join(" ") || "zero"} Saudi riyals`
  if (halalas) text += ` and ${englishBelowThousand(halalas)} halalas`
  return `Only ${text}.`
}

/** The document's language decides the words (QC-19). */
export function amountInWords(amount: number, locale: string): string {
  return locale === "ar" ? amountInArabicWords(amount) : amountInEnglishWords(amount)
}
