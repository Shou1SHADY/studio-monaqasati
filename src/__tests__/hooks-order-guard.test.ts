import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

const ROOTS = ["src/components", "src/app"]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : []
  })
}

describe("hooks keep one order (React error #310)", () => {
  it("no component returns early before calling a hook", () => {
    const offenders: string[] = []
    for (const file of ROOTS.flatMap(files)) {
      const lines = readFileSync(file, "utf8").split("\n")
      let i = 0
      while (i < lines.length) {
        const m = /^(export )?(default )?function ([A-Z]\w*)\(/.exec(lines[i])
        if (!m) {
          i++
          continue
        }
        let j = i + 1
        let early: number | null = null
        while (j < lines.length && !/^}/.test(lines[j])) {
          if (early === null && /^  if \(.*\) return\b/.test(lines[j])) early = j + 1
          else if (early !== null && /^  (const .*= |const \[.*\] = )?use[A-Z]\w*[(<]/.test(lines[j])) {
            offenders.push(`${file}:${j + 1} ${m[3]} (early return at line ${early})`)
            break
          }
          j++
        }
        i = j
      }
    }
    expect(offenders).toEqual([])
  })
})
