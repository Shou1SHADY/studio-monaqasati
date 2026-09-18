// The official Saudi Riyal symbol.
//
// U+20C1 SAUDI RIYAL SIGN (Unicode 17). Installed fonts do not draw it yet, so
// public/fonts/saudi-riyal.otf does — one glyph, registered in globals.css for
// that code point only (built by scripts/build-riyal-font.js from SAMA's
// artwork). Because it is a character and not an image it works inside
// translation strings, toasts, chart labels and anything the browser prints.
//
// NOT for: CSV/Excel exports, e-mails, or the print windows that write their
// own HTML document (accounting/print.ts, MfgDeliveryNotePrint, IpcClaimsTab) —
// the font is not there, and a reader without it sees an empty box. Write
// "SAR" / "ر.س" in those.
//
// Do not use U+FDFC: that is the generic "rial" ligature the prototype
// used, shared with Iran, Oman and Yemen — not this symbol.

export const SAR_SIGN = "\u20C1"

const NBSP = "\u00A0"

/**
 * A figure with its sign, for text that runs left-to-right — an English
 * sentence, or a number isolated with `dir="ltr"` / `<bdi>` inside Arabic.
 * SAMA's rule is the same in both scripts: the sign stands to the LEFT of the
 * figure, one space apart. In an LTR run that means the sign comes first.
 */
export function sarLtr(figure: string): string {
  return `${SAR_SIGN}${NBSP}${figure}`
}

/**
 * The same, for a figure that flows with Arabic text (no LTR isolation): the
 * figure comes first in the string, and the right-to-left line puts the sign
 * on its left. Translation strings in ar.json follow this order too.
 */
export function sarRtl(figure: string): string {
  return `${figure}${NBSP}${SAR_SIGN}`
}

export function withSarSign(figure: string, locale: string): string {
  return locale === "ar" ? sarRtl(figure) : sarLtr(figure)
}
