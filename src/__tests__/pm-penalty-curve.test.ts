import fs from "fs"
import path from "path"

// The penalty «بمعدل التأخر الحالي» is measured against the programme's S-curve
// (the prototype's pPlan). A call without curveK falls back to a straight line
// and told the demo project "no delay" while the head said 41 points behind.
describe("every penalty estimate on a screen reads the programme's curve", () => {
  const roots = ["src/components/pm", "src/hooks"]
  const files = roots.flatMap((r) => fs.readdirSync(r).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(r, f)))

  it.each(files.filter((f) => /delayAndDamages\(\{/.test(fs.readFileSync(f, "utf8"))))("%s", (f) => {
    const src = fs.readFileSync(f, "utf8")
    const calls = src.split("delayAndDamages({").slice(1).map((c) => {
      let depth = 1
      for (let i = 0; i < c.length; i++) {
        if (c[i] === "{") depth++
        else if (c[i] === "}" && --depth === 0) return c.slice(0, i)
      }
      return c
    })
    for (const call of calls) expect(call.includes("curveK") || call.trim().startsWith("...")).toBe(true)
  })
})
