// Builds public/fonts/saudi-riyal.otf — a ONE-glyph font that draws the official
// Saudi Riyal symbol at U+20C1 (SAUDI RIYAL SIGN, Unicode 17).
//
// Why a font and not an <svg>: the sign appears inside translation strings,
// toasts, chart labels and printed documents. Almost no installed font has
// U+20C1 yet, so the page would show a box. globals.css registers this file
// with `unicode-range: U+20C1`, which means it is consulted for that one
// character and nothing else — every other glyph still comes from Noto/Inter.
//
// The outline is the symbol published by the Saudi Central Bank (SAMA), taken
// unmodified from its SVG (viewBox 0 0 1124.14 1256.39). SAMA's usage rules:
// never redrawn, mirrored or slanted; as tall as the figures beside it; to the
// LEFT of the figure with a space between. The height rule is what the scale
// below implements; the placement rule is `withSarSign` in src/lib/riyal.ts.
//
// opentype.js is a build-time tool only and is NOT a dependency of the app:
//   npm i --no-save opentype.js@1.3.4 && node scripts/build-riyal-font.js

const fs = require("fs")
const path = require("path")
const opentype = require("opentype.js")

const VIEW_W = 1124.14
const VIEW_H = 1256.39
const CONTOURS = [
  "M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z",
  "M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z",
]

const UNITS_PER_EM = 1000
// Lining figures stand ~0.72em tall in both Inter (0.727) and Noto Sans Arabic
// (0.714); the sign sits on the baseline at that height.
const GLYPH_HEIGHT = 720
const SIDE_BEARING = 36
const SCALE = GLYPH_HEIGHT / VIEW_H

const tx = (x) => Math.round((SIDE_BEARING + x * SCALE) * 100) / 100
const ty = (y) => Math.round((VIEW_H - y) * SCALE * 100) / 100 // SVG y runs down, a font's runs up

/** The SVG subset the artwork uses: M/m L/l H/h V/v C/c Z/z, with implicit repeats. */
function draw(d, pen) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g)
  let i = 0
  let x = 0
  let y = 0
  let cmd = ""
  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = num(), ny = num()
        x = rel ? x + nx : nx
        y = rel ? y + ny : ny
        pen.moveTo(tx(x), ty(y))
        cmd = rel ? "l" : "L" // further pairs after a moveto are linetos
        break
      }
      case "L": {
        const nx = num(), ny = num()
        x = rel ? x + nx : nx
        y = rel ? y + ny : ny
        pen.lineTo(tx(x), ty(y))
        break
      }
      case "H": {
        const nx = num()
        x = rel ? x + nx : nx
        pen.lineTo(tx(x), ty(y))
        break
      }
      case "V": {
        const ny = num()
        y = rel ? y + ny : ny
        pen.lineTo(tx(x), ty(y))
        break
      }
      case "C": {
        const c = [num(), num(), num(), num(), num(), num()]
        const p = rel ? [x + c[0], y + c[1], x + c[2], y + c[3], x + c[4], y + c[5]] : c
        pen.curveTo(tx(p[0]), ty(p[1]), tx(p[2]), ty(p[3]), tx(p[4]), ty(p[5]))
        x = p[4]
        y = p[5]
        break
      }
      case "Z":
        pen.close()
        break
      default:
        throw new Error(`unsupported path command "${cmd}"`)
    }
  }
}

const outline = new opentype.Path()
for (const d of CONTOURS) draw(d, outline)

const advanceWidth = Math.round(VIEW_W * SCALE + SIDE_BEARING * 2)
const notdef = new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth, path: new opentype.Path() })
const sign = new opentype.Glyph({ name: "uni20C1", unicode: 0x20c1, advanceWidth, path: outline })

const font = new opentype.Font({
  familyName: "Saudi Riyal Sign",
  styleName: "Regular",
  unitsPerEm: UNITS_PER_EM,
  ascender: 800,
  descender: -200,
  designer: "Saudi Central Bank (SAMA) — symbol artwork",
  description: "One glyph: the official Saudi Riyal symbol at U+20C1.",
  glyphs: [notdef, sign],
})

const out = path.join(__dirname, "..", "public", "fonts", "saudi-riyal.otf")
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(font.toArrayBuffer()))
console.log(`wrote ${path.relative(process.cwd(), out)} — ${fs.statSync(out).size} bytes, advance ${advanceWidth}/${UNITS_PER_EM}`)
