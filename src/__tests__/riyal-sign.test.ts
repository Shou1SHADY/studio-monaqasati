// The official Saudi Riyal symbol (U+20C1) replaced the prototype's generic
// rial ligature (U+FDFC). These guards keep the old glyph out, keep the sign on
// the correct side of the figure, and keep the one-glyph font honest.

import fs from "fs"
import path from "path"
import { SAR_SIGN, sarLtr, sarRtl, withSarSign } from "@/lib/riyal"

const ROOT = path.join(__dirname, "..", "..")
const OLD_RIAL_LIGATURE = String.fromCharCode(0xfdfc)
const NBSP = String.fromCharCode(0xa0)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

function strings(node: unknown, trail: string[] = [], out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([trail.join("."), node])
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, [...trail, k], out)
  return out
}

describe("the Riyal sign", () => {
  it("is U+20C1, tied to its figure with a no-break space", () => {
    expect(SAR_SIGN.codePointAt(0)).toBe(0x20c1)
    expect(sarLtr("1,250")).toBe(`${SAR_SIGN}${NBSP}1,250`)
    expect(sarRtl("1,250")).toBe(`1,250${NBSP}${SAR_SIGN}`)
  })

  it("stands to the LEFT of the figure in both scripts (SAMA's rule)", () => {
    // In an LTR run the sign comes first; in Arabic flow the figure comes first
    // and the right-to-left line places the sign on its left.
    expect(withSarSign("19,734", "en").startsWith(SAR_SIGN)).toBe(true)
    expect(withSarSign("19,734", "ar").endsWith(SAR_SIGN)).toBe(true)
  })

  it("the prototype's generic rial ligature is gone from the app and its strings", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => fs.readFileSync(f, "utf8").includes(OLD_RIAL_LIGATURE))
      .map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
    for (const lang of ["ar", "en"]) expect(fs.readFileSync(path.join(ROOT, "messages", `${lang}.json`), "utf8").includes(OLD_RIAL_LIGATURE)).toBe(false)
  })

  it("English strings never put the sign after the figure", () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, "messages", "en.json"), "utf8"))
    const wrong = strings(en).filter(([, text]) => new RegExp(`\\}[\\s${NBSP}]*${SAR_SIGN}`).test(text))
    expect(wrong.map(([key]) => key)).toEqual([])
  })

  it("the font draws that one code point and is registered for it alone", () => {
    const font = path.join(ROOT, "public", "fonts", "saudi-riyal.otf")
    expect(fs.existsSync(font)).toBe(true)
    expect(fs.statSync(font).size).toBeLessThan(8 * 1024)
    const css = fs.readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8")
    const faces = css.match(/@font-face\s*\{[^}]*Saudi Riyal Sign[^}]*\}/g) || []
    // upright AND italic, so the browser never slants or fakes a bold of the sign
    expect(faces).toHaveLength(2)
    for (const face of faces) {
      expect(face).toContain("unicode-range: U+20C1")
      expect(face).toContain("font-weight: 100 900")
    }
    expect(faces.some((f) => f.includes("font-style: italic"))).toBe(true)
  })
})
