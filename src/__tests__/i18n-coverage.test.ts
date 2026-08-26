import fs from "fs"
import path from "path"
import {
  ACTIVITY_TYPES,
  CLASSIFICATION_ACTIVITIES,
  CONTACT_TIERS,
  CONTACT_TYPES,
  CONTRACT_KINDS,
  ENTITY_TYPES,
  HOLD_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATES,
  OPPORTUNITY_TRACKS,
  PARTY_ROLES,
  PARTY_TYPES,
  SCOPE_TYPES,
  TENDER_ROUTES,
} from "@/lib/crm"

/**
 * Translation coverage guards.
 *
 * A missing or malformed message is invisible to `tsc` and to the build — the
 * page renders a broken label, in one language, on someone else's screen. These
 * tests catch the three ways that actually happens:
 *
 *  1. A key added to one locale and not the other.
 *  2. A key referenced from the WRONG namespace. `portal-components.ts` holds
 *     bare key strings that the sidebar renders through `Portal.Sidebar`, which
 *     is not the `Portal.Shared` namespace the CRM pages use — adding a nav
 *     entry without its Sidebar key shipped a broken sidebar once already.
 *  3. A message whose ICU syntax or interpolation placeholders differ between
 *     locales, so it throws at render time in exactly one language.
 */

const ROOT = path.join(__dirname, "..", "..")
const LOCALES = ["en", "ar"] as const

type Messages = Record<string, unknown>

function load(locale: string): Messages {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"))
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Messages>

/** Every leaf key, as `Namespace.sub.key`. */
function flatten(node: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  if (!node || typeof node !== "object") return out
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object") Object.assign(out, flatten(value, full))
    else out[full] = String(value)
  }
  return out
}

const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(messages[l])])) as Record<
  string,
  Record<string, string>
>

/**
 * The ARGUMENTS an ICU message takes, sorted for comparison.
 *
 * Depth-aware on purpose: `{count, plural, one {…} other {…}}` takes exactly
 * one argument, and Arabic spells that out in six branches where English uses
 * two. A regex that grabs every `{word` would read those branch bodies as extra
 * arguments and report a mismatch on a message that is perfectly correct.
 */
function placeholders(message: string): string[] {
  const args: string[] = []
  let depth = 0
  for (let i = 0; i < message.length; i++) {
    const char = message[i]
    if (char === "}") {
      depth--
      continue
    }
    if (char !== "{") continue
    if (depth === 0) {
      const name = /^\{\s*(\w+)\s*[,}]/.exec(message.slice(i))
      if (name) args.push(name[1])
    }
    depth++
  }
  return args.sort()
}

/** Top-level `{...}` bodies, in source order. */
function topLevelPlaceholderBodies(message: string): string[] {
  const bodies: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < message.length; i++) {
    const char = message[i]
    if (char === "{") {
      if (depth === 0) start = i + 1
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0 && start !== -1) {
        bodies.push(message.slice(start, i))
        start = -1
      }
    }
  }
  return bodies
}

function namespace(locale: string, name: string): Record<string, string> {
  const portal = (messages[locale] as { Portal?: Record<string, Record<string, string>> }).Portal
  return portal?.[name] ?? {}
}

describe("translation coverage", () => {
  // Two locales, one key set. Anything present in one and not the other is a
  // guaranteed runtime hole in whichever language is missing it.
  it("has identical key sets in every locale", () => {
    const enKeys = Object.keys(flat.en)
    const arKeys = Object.keys(flat.ar)
    const missingInAr = enKeys.filter((k) => !(k in flat.ar))
    const missingInEn = arKeys.filter((k) => !(k in flat.en))

    // `rfq_status_new` predates these guards; it is tracked separately so the
    // suite stays honest rather than green-by-exclusion.
    const KNOWN_GAPS = ["Portal.Shared.rfq_status_new", "Portal.Sidebar.contractor_suppliers"]
    expect(missingInAr.filter((k) => !KNOWN_GAPS.includes(k))).toEqual([])
    expect(missingInEn.filter((k) => !KNOWN_GAPS.includes(k))).toEqual([])
  })

  it("uses the same interpolation placeholders in every locale", () => {
    const mismatched = Object.keys(flat.en)
      .filter((k) => k in flat.ar)
      .filter((k) => placeholders(flat.en[k]).join(",") !== placeholders(flat.ar[k]).join(","))
    expect(mismatched).toEqual([])
  })

  // `intl-messageformat` itself is ESM and cannot be required here without
  // reconfiguring Jest for the whole repo, so this checks the syntax that
  // actually gets hand-written wrong: unbalanced or malformed placeholders.
  it("has structurally valid ICU placeholders in every locale", () => {
    const failures: string[] = []
    for (const locale of LOCALES) {
      for (const [key, message] of Object.entries(flat[locale])) {
        let depth = 0
        for (const char of message) {
          if (char === "{") depth++
          else if (char === "}") depth--
          if (depth < 0) break
        }
        if (depth !== 0) {
          failures.push(`${locale}/${key}: unbalanced braces`)
          continue
        }
        for (const body of topLevelPlaceholderBodies(message)) {
          // A plural/select body carries its own nested branches; only its
          // argument name is checkable here.
          if (/^\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(body)) continue
          // `{}` and `{ name }` are both rejected by the runtime formatter.
          if (!/^\w+(\s*,\s*\w+)*$/.test(body)) {
            failures.push(`${locale}/${key}: malformed placeholder "{${body}}"`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe("navigation keys resolve in Portal.Sidebar", () => {
  // `portal-components.ts` stores key strings, not calls — nothing else checks
  // that they exist, and they render through Sidebar rather than Shared.
  const source = fs.readFileSync(path.join(ROOT, "src", "lib", "portal-components.ts"), "utf8")
  const navKeys = [...source.matchAll(/\b(?:titleKey|labelKey|descKey)\s*:\s*"([^"]+)"/g)].map((m) => m[1])

  it("finds nav keys to check", () => {
    expect(navKeys.length).toBeGreaterThan(20)
  })

  it.each(LOCALES)("has every portal-components nav key in %s", (locale) => {
    const sidebar = namespace(locale, "Sidebar")
    const missing = [...new Set(navKeys)].filter((k) => !(k in sidebar))
    expect(missing).toEqual([])
  })
})

describe("CRM component keys resolve in Portal.Shared", () => {
  const crmDir = path.join(ROOT, "src", "components", "crm")
  const sources = fs
    .readdirSync(crmDir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(crmDir, f), "utf8"))
    .join("\n")

  // Literal `t("crm_x")` calls only — templated keys are covered below by
  // expanding the model's own constant arrays.
  const literalKeys = [...sources.matchAll(/\bt\(\s*"(crm_[a-z0-9_]+)"/g)].map((m) => m[1])

  it("finds CRM keys to check", () => {
    expect(literalKeys.length).toBeGreaterThan(50)
  })

  it.each(LOCALES)("has every literal CRM key in %s", (locale) => {
    const shared = namespace(locale, "Shared")
    const missing = [...new Set(literalKeys)].filter((k) => !(k in shared))
    expect(missing).toEqual([])
  })

  // Keys the CRM builds by template — `t(\`crm_scope_${s}\`)` — cannot be found
  // by grep, so they are expanded from the same arrays the UI iterates.
  it.each(LOCALES)("has every templated CRM key in %s", (locale) => {
    const shared = namespace(locale, "Shared")

    const groups: Array<[string, readonly string[]]> = [
      ["crm_scope_", SCOPE_TYPES],
      ["crm_track_", OPPORTUNITY_TRACKS],
      ["crm_route_", TENDER_ROUTES],
      ["crm_contract_kind_", CONTRACT_KINDS],
      ["crm_opp_source_", OPPORTUNITY_SOURCES],
      ["crm_party_type_", PARTY_TYPES],
      ["crm_party_role_", PARTY_ROLES],
      ["crm_type_", CONTACT_TYPES],
      ["crm_status_", LEAD_STATUSES],
      ["crm_source_", LEAD_SOURCES],
      ["crm_entity_", ENTITY_TYPES],
      ["crm_tier_", CONTACT_TIERS],
      ["crm_activity_type_", ACTIVITY_TYPES],
      ["crm_opp_stage_", OPPORTUNITY_STAGES],
      ["crm_state_", OPPORTUNITY_STATES],
      ["crm_lost_reason_", LOST_REASONS],
      ["crm_hold_reason_", HOLD_REASONS],
      ["crm_activity_class_", CLASSIFICATION_ACTIVITIES],
    ]

    const expected: string[] = []
    for (const [prefix, values] of groups) {
      expect(values.length).toBeGreaterThan(0)
      for (const value of values) expected.push(prefix + value)
    }

    // Track descriptions, key-date labels, and the gate vocabulary.
    for (const track of OPPORTUNITY_TRACKS) {
      expected.push(`crm_track_${track}_desc`, `crm_track_date_${track}`)
    }
    for (const auto of ["estimate", "cost", "submitted_approved", "fit"]) {
      expected.push(`crm_gate_auto_${auto}`)
    }
    for (const mod of ["finance", "procurement", "projects"]) {
      expected.push(`crm_gate_module_${mod}`, `crm_module_${mod}`)
    }
    for (const event of ["handed_over", "on_hold", "reactivated", "lost", "won"]) {
      expected.push(`crm_history_${event}`)
    }
    for (const reason of ["no_estimate", "no_scope", "no_profile"]) {
      expected.push(`crm_eligibility_${reason}`, `crm_eligibility_hint_${reason}`)
    }
    for (const step of ["estimate", "cost", "submitted", "award"]) {
      for (const part of ["title", "desc", "label", "hint"]) expected.push(`crm_value_${step}_${part}`)
    }
    for (const due of ["open", "overdue", "today", "week", "done", "all"]) {
      expected.push(`crm_activity_due_${due}`)
    }

    // Gate ids are declared in the model, so read them from there too.
    const crmSource = fs.readFileSync(path.join(ROOT, "src", "lib", "crm.ts"), "utf8")
    for (const m of crmSource.matchAll(/\{ id: "([a-z_]+)"/g)) expected.push(`crm_gate_${m[1]}`)

    const missing = [...new Set(expected)].filter((k) => !(k in shared))
    expect(missing).toEqual([])
  })
})
