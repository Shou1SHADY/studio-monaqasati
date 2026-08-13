/**
 * Unit tests for src/lib/project-sections.ts
 *
 * Covers:
 *  1. SECTION_REGISTRY catalog completeness and shape
 *  2. cascadeEnable — turning a section on auto-enables transitive deps
 *  3. cascadeDisable — turning a section off cascades to dependents, protects required
 *  4. defaultEnabledSections — only required sections
 *  5. sectionLabelKey / sectionDescKey helpers
 *  6. LEGACY_DEFAULT_SECTIONS fallback
 */

import {
  SECTION_IDS,
  SECTION_GROUPS,
  SECTION_REGISTRY,
  PIPELINE_STAGES,
  cascadeEnable,
  cascadeDisable,
  defaultEnabledSections,
  sectionLabelKey,
  sectionDescKey,
  LEGACY_DEFAULT_SECTIONS,
  type SectionId,
} from "../lib/project-sections"

// ─────────────────────────────────────────────────────────────────────────────
// 1. SECTION_REGISTRY — catalog completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("SECTION_REGISTRY", () => {
  it("has exactly 18 sections", () => {
    expect(SECTION_IDS.length).toBe(18)
  })

  it("has no duplicate ids", () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length)
  })

  it("has a registry entry for every id in SECTION_IDS", () => {
    SECTION_IDS.forEach((id) => {
      expect(SECTION_REGISTRY[id]).toBeDefined()
      expect(SECTION_REGISTRY[id].id).toBe(id)
    })
  })

  it("every section belongs to a valid group", () => {
    SECTION_IDS.forEach((id) => {
      expect(SECTION_GROUPS).toContain(SECTION_REGISTRY[id].group)
    })
  })

  it("every dependsOn entry references a real section id", () => {
    SECTION_IDS.forEach((id) => {
      SECTION_REGISTRY[id].dependsOn.forEach((dep) => {
        expect(SECTION_IDS).toContain(dep)
      })
    })
  })

  it("every stage referenced is a valid pipeline stage", () => {
    SECTION_IDS.forEach((id) => {
      SECTION_REGISTRY[id].stages.forEach((stage) => {
        expect(PIPELINE_STAGES).toContain(stage)
      })
    })
  })

  it("exactly contract and procure are required", () => {
    const required = SECTION_IDS.filter((id) => SECTION_REGISTRY[id].required)
    expect(required.sort()).toEqual(["contract", "procure"])
  })

  it("required sections have no dependsOn (nothing to cascade)", () => {
    SECTION_IDS.filter((id) => SECTION_REGISTRY[id].required).forEach((id) => {
      expect(SECTION_REGISTRY[id].dependsOn).toEqual([])
    })
  })

  it("marks exactly the expected sections as built vs ghost", () => {
    const built = SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status === "built").sort()
    expect(built).toEqual(["collect", "contract", "ipc", "procure", "receive", "store"].sort())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. cascadeEnable
// ─────────────────────────────────────────────────────────────────────────────

describe("cascadeEnable", () => {
  it("enables a section with no dependencies on its own", () => {
    const result = cascadeEnable(new Set<SectionId>(["contract", "procure"]), "docs")
    expect(result.has("docs")).toBe(true)
    expect(result.size).toBe(3)
  })

  it("auto-enables a direct dependency", () => {
    // store depends on receive
    const result = cascadeEnable(new Set<SectionId>(["contract", "procure"]), "store")
    expect(result.has("store")).toBe(true)
    expect(result.has("receive")).toBe(true)
  })

  it("auto-enables transitive dependencies (collect -> ipc -> progress)", () => {
    const result = cascadeEnable(new Set<SectionId>(["contract", "procure"]), "collect")
    expect(result.has("collect")).toBe(true)
    expect(result.has("ipc")).toBe(true)
    expect(result.has("progress")).toBe(true)
  })

  it("is a no-op if the section and its deps are already enabled", () => {
    const base = new Set<SectionId>(["contract", "procure", "receive", "store"])
    const result = cascadeEnable(base, "store")
    expect(result).toEqual(base)
  })

  it("does not mutate the input set", () => {
    const base = new Set<SectionId>(["contract", "procure"])
    cascadeEnable(base, "docs")
    expect(base.has("docs")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. cascadeDisable
// ─────────────────────────────────────────────────────────────────────────────

describe("cascadeDisable", () => {
  it("disables a section with no dependents on its own", () => {
    const result = cascadeDisable(new Set<SectionId>(["contract", "procure", "docs"]), "docs")
    expect(result.has("docs")).toBe(false)
    expect(result.size).toBe(2)
  })

  it("refuses to disable a required section", () => {
    const base = new Set<SectionId>(["contract", "procure"])
    const result = cascadeDisable(base, "contract")
    expect(result.has("contract")).toBe(true)
    expect(result).toEqual(base)
  })

  it("cascades off a direct dependent (disabling receive turns off store)", () => {
    const base = new Set<SectionId>(["contract", "procure", "receive", "store"])
    const result = cascadeDisable(base, "receive")
    expect(result.has("receive")).toBe(false)
    expect(result.has("store")).toBe(false)
  })

  it("cascades off transitive dependents (disabling progress turns off ipc and collect)", () => {
    const base = new Set<SectionId>(["contract", "procure", "progress", "ipc", "collect"])
    const result = cascadeDisable(base, "progress")
    expect(result.has("progress")).toBe(false)
    expect(result.has("ipc")).toBe(false)
    expect(result.has("collect")).toBe(false)
  })

  it("does not affect unrelated enabled sections", () => {
    const base = new Set<SectionId>(["contract", "procure", "receive", "store", "docs"])
    const result = cascadeDisable(base, "receive")
    expect(result.has("docs")).toBe(true)
    expect(result.has("contract")).toBe(true)
    expect(result.has("procure")).toBe(true)
  })

  it("does not mutate the input set", () => {
    const base = new Set<SectionId>(["contract", "procure", "docs"])
    cascadeDisable(base, "docs")
    expect(base.has("docs")).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. defaultEnabledSections
// ─────────────────────────────────────────────────────────────────────────────

describe("defaultEnabledSections", () => {
  it("returns only the required sections", () => {
    const result = defaultEnabledSections()
    expect(Array.from(result).sort()).toEqual(["contract", "procure"])
  })

  it("returns a fresh Set each call (not a shared reference)", () => {
    const a = defaultEnabledSections()
    const b = defaultEnabledSections()
    expect(a).not.toBe(b)
    a.add("docs")
    expect(b.has("docs")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. label/desc key helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("sectionLabelKey / sectionDescKey", () => {
  it("produces sec_{id}_title and sec_{id}_desc for every section", () => {
    SECTION_IDS.forEach((id) => {
      expect(sectionLabelKey(id)).toBe(`sec_${id}_title`)
      expect(sectionDescKey(id)).toBe(`sec_${id}_desc`)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. LEGACY_DEFAULT_SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("LEGACY_DEFAULT_SECTIONS", () => {
  it("is contract, procure, docs", () => {
    expect(LEGACY_DEFAULT_SECTIONS).toEqual(["contract", "procure", "docs"])
  })

  it("every entry is a valid section id", () => {
    LEGACY_DEFAULT_SECTIONS.forEach((id) => {
      expect(SECTION_IDS).toContain(id)
    })
  })
})
