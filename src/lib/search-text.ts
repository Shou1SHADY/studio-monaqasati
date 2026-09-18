// Folding text for search boxes.
//
// A search that demands the exact hamza, the exact final ة or the diacritics
// somebody else typed is a search that "cannot find" a record that is there.
// `foldSearchText` lowers Latin, strips Arabic diacritics and tatweel, and
// unifies the letter forms people use interchangeably; `matchesSearch` asks
// whether every word of the query appears somewhere in the fields, so
// "افق رخام" finds "شركة الأفق — رخام كرارة".

// Harakat, superscript alef and tatweel.
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g
const ALEF_FORMS = /[\u0623\u0625\u0622\u0671]/g // أ إ آ ٱ
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g

export function foldSearchText(value: string | number | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(ALEF_FORMS, "\u0627") // ا
    .replace(/\u0649/g, "\u064A") // ى → ي
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0624/g, "\u0648") // ؤ → و
    .replace(/\u0626/g, "\u064A") // ئ → ي
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)) // ٢٠٢٦ finds 2026
    .replace(/\s+/g, " ")
    .trim()
}

/** Every word of `term` occurs in one of `fields`. An empty term matches. */
export function matchesSearch(term: string, fields: Array<string | number | null | undefined>): boolean {
  const words = foldSearchText(term).split(" ").filter(Boolean)
  if (!words.length) return true
  // Words carry no spaces, so joining on one cannot create a match across two fields.
  const haystack = fields.map(foldSearchText).join(" ")
  return words.every((w) => haystack.includes(w))
}
