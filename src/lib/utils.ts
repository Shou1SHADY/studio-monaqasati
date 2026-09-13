import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Keep only what a decimal quantity can contain, as the user types.
 *
 * Arabic keyboards produce Eastern Arabic digits (٠–٩, and the Persian ۰–۹) and
 * the Arabic decimal separator «٫»; all of them become their Latin equivalents
 * so `Number()` reads them. Anything else — a unit typed into the quantity box
 * ("m2", «م²») is the usual case — is dropped instead of silently turning the
 * whole field into NaN, which used to make a filled-in line vanish at submit.
 */
export function sanitizeDecimalInput(raw: string): string {
  const latin = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
  let out = ""
  let seenDot = false
  for (const ch of latin) {
    if (ch >= "0" && ch <= "9") out += ch
    else if (ch === "." && !seenDot) {
      out += ch
      seenDot = true
    }
  }
  return out
}
