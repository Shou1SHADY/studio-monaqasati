import { runAll, type RuleCase } from "./sim"

const ORG = "uilut3A3HnV13RiZXYqd3KgeNCH3"
const OWNER = ORG
const MEMBER = "ALeoSloXkjczUp6dK2DPEKheqcR2"
type Data = Record<string, unknown>

const base: Data = { organizationId: ORG, status: "awaiting_approval", preparedById: OWNER, totalExVat: 2900, vatRate: 0.15, basis: "direct", approverKind: "manager", docNumber: "PO-T/1", supplierOrgId: "s1", supplierUserId: "s1", isGuestSupplier: false, createdAt: "2026-10-08T00:00:00Z", log: [] }
const approved: Data = { status: "approved", approvedById: OWNER, approvedByName: "x", approvedAt: "2026-10-08T00:00:00Z", returnedReason: null, log: [{}] }
const switches = (off: string[] | null): Record<string, Data | null> => ({ [`companyModules/${ORG}`]: off ? { organizationId: ORG, off } : null })
const pmOff = switches(["project-management"])
const pmOn = switches(null)

const mk = (name: string, before: Data, after: Data, overrides: Record<string, Data | null>, expect: "ALLOW" | "DENY", uid = OWNER): RuleCase => ({ name, uid, method: "update", path: "purchaseOrders/t1", before, after, overrides, expect })

const withBudget = (state: string): Data => ({ ...base, pmBudget: { state, over: 500 } })
const done = (b: Data, by = OWNER): Data => ({ ...b, ...approved, approvedById: by })

const cases: RuleCase[] = [
  mk("owner approves a clean order", base, done(base), pmOn, "ALLOW"),
  mk("budget decision pending, Project Management ON: refused", withBudget("pending"), done(withBudget("pending")), pmOn, "DENY"),
  mk("budget decision pending, Project Management OFF: allowed", withBudget("pending"), done(withBudget("pending")), pmOff, "ALLOW"),
  mk("renegotiate, Project Management ON: refused", withBudget("renegotiate"), done(withBudget("renegotiate")), pmOn, "DENY"),
  mk("renegotiate, Project Management OFF: allowed", withBudget("renegotiate"), done(withBudget("renegotiate")), pmOff, "ALLOW"),
  mk("budget accepted, Project Management ON: allowed", withBudget("accepted"), done(withBudget("accepted")), pmOn, "ALLOW"),
  mk("HR and Manufacturing off do not lift the gate", withBudget("pending"), done(withBudget("pending")), switches(["hr", "manufacturing"]), "DENY"),
  mk("a stranger from another company cannot approve", base, done(base, "someone-else"), { ...pmOn, "users/someone-else": { organizationId: "other", role: "Contractor" } }, "DENY", "someone-else"),
  mk("a member without po.approve cannot approve", base, done(base, MEMBER), pmOn, "DENY", MEMBER),
]

runAll(cases).then((bad) => process.exit(bad ? 1 : 0))
