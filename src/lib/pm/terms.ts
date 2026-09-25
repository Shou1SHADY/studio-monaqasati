// PM 1.0 — the contract's terms (PRD §8, §9 TRM/AMD, §13). These are not
// settings: each one opens or closes a screen and decides a number. They are
// completed before start, frozen at start as "the original as signed", and
// changed afterwards only by an addendum on top of it — never overwritten
// (S-06). Value changes by variation and duration by extension, never here.
// Pure: no I/O.

export const PAYERS = ["owner", "main", "none"] as const
export type Payer = (typeof PAYERS)[number]
export const PRICING_BASES = ["rem", "lump"] as const
export type PricingBasis = (typeof PRICING_BASES)[number]
export const ADVANCE_RECOVERY = ["pro", "once"] as const
export type AdvanceRecovery = (typeof ADVANCE_RECOVERY)[number]
export const RETENTION_RELEASE = ["half", "full"] as const
export type RetentionRelease = (typeof RETENTION_RELEASE)[number]

export interface DelayDamages {
  on: boolean
  /** Per full week of delay, as a fraction of the contract (0.005 = 0.5%). */
  weeklyRate: number
  /** Ceiling as a fraction of the contract (0.10 = 10%). */
  cap: number
}

/** Rates are fractions (0.10 = 10%); periods are days. */
export interface ContractTerms {
  payer: Payer
  basis: PricingBasis
  advance: number
  advanceRecovery: AdvanceRecovery
  retention: number
  retentionCap: number
  retentionRelease: RetentionRelease
  paymentDays: number
  consultantDays: number
  claimNoticeDays: number
  defectsDays: number
  damages: DelayDamages
}

export type TermKey = keyof ContractTerms

/** Financial terms: a signed addendum changing one of these sends prj:AMD (AMD-08). */
export const FINANCIAL_TERMS: readonly TermKey[] = ["payer", "advance", "advanceRecovery", "retention", "retentionCap", "retentionRelease", "paymentDays"]

/** PRD §13 defaults. The handover's advance and retention win when it carries them. */
export function defaultTerms(from: { advance?: number | null; retention?: number | null; selfDevelopment?: boolean } = {}): ContractTerms {
  return {
    payer: from.selfDevelopment ? "none" : "owner",
    basis: "rem",
    advance: from.advance ?? 0,
    advanceRecovery: "pro",
    retention: from.retention ?? 0,
    retentionCap: 0.05,
    retentionRelease: "half",
    paymentDays: 30,
    consultantDays: 14,
    claimNoticeDays: 28,
    defectsDays: 365,
    damages: { on: false, weeklyRate: 0.005, cap: 0.1 },
  }
}

export type TermProblem = "advance_range" | "retention_range" | "cap_range" | "days_range" | "damages_range"

const frac = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1
const days = (n: number) => Number.isInteger(n) && n >= 0 && n <= 3650

/** What stops these terms being saved. The retention rate may exceed its cap (§13). */
export function termProblems(t: ContractTerms): TermProblem[] {
  const out: TermProblem[] = []
  if (!frac(t.advance)) out.push("advance_range")
  if (!frac(t.retention)) out.push("retention_range")
  if (!frac(t.retentionCap)) out.push("cap_range")
  if (![t.paymentDays, t.consultantDays, t.claimNoticeDays, t.defectsDays].every(days)) out.push("days_range")
  if (t.damages.on && !(frac(t.damages.weeklyRate) && frac(t.damages.cap) && t.damages.weeklyRate > 0 && t.damages.cap > 0)) out.push("damages_range")
  return out
}

/** "Nobody pays" (self-development) switches certificates and collection off (TRM-01). */
export const hasClientSide = (t: Pick<ContractTerms, "payer">) => t.payer !== "none"

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return a === b
}

/** One changed term inside an addendum: from → to (AMD-01). */
export interface TermChange<K extends TermKey = TermKey> {
  key: K
  from: ContractTerms[K]
  to: ContractTerms[K]
}

/** The terms that differ between two versions — what an addendum would record. */
export function termChanges(before: ContractTerms, after: ContractTerms): TermChange[] {
  return (Object.keys(before) as TermKey[]).filter((k) => !same(before[k], after[k])).map((k) => ({ key: k, from: before[k], to: after[k] }) as TermChange)
}

/** The contract in force = the original + signed addenda in signing order (§8).
 * A draft or withdrawn addendum changes nothing (AMD-02). */
export function termsInForce(original: ContractTerms, addenda: Array<{ status: "draft" | "signed" | "void"; signedSeq?: number | null; changes: TermChange[] }>): ContractTerms {
  const signed = addenda.filter((a) => a.status === "signed").sort((a, b) => (a.signedSeq ?? 0) - (b.signedSeq ?? 0))
  const out: ContractTerms = { ...original, damages: { ...original.damages } }
  for (const a of signed) for (const c of a.changes) (out as unknown as Record<string, unknown>)[c.key] = typeof c.to === "object" ? { ...(c.to as object) } : c.to
  return out
}

/** Terms are edited directly only before start; after it, only an addendum
 * changes them — refused at the button and again at save (TRM-02). */
export const termsEditable = (lifecycle: string) => lifecycle === "plan"
