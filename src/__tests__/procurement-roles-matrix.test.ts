import { isRequesterOnly, roleColumns, roleRows } from "@/lib/procurement/roles-matrix"
import type { PermissionId } from "@/lib/permissions"

const full = { financeOn: true, pmOn: false, mfgOn: false, ownerStepsBack: false }

describe("Settings → roles (Procurement 2.0 PRD §4)", () => {
  it("has the fourteen rows of the matrix, in its order", () => {
    expect(roleRows(full).map((r) => r.id)).toEqual([
      "prices",
      "publish",
      "compare",
      "award",
      "approve",
      "approve_over",
      "cancel",
      "escalate",
      "expedite",
      "invite_suppliers",
      "manual_receipt",
      "raise_request",
      "settings",
      "subscription",
    ])
  })

  it("the owner holds every act; the manager approves up to his limit and sets sites and receivers, never the policies", () => {
    const rows = roleRows(full)
    expect(rows.every((r) => r.cells.owner === true)).toBe(true)
    expect(rows.find((r) => r.id === "approve")?.cells.manager).toBe("limit")
    expect(rows.find((r) => r.id === "approve_over")?.cells).toMatchObject({ owner: true, manager: false, buyer: false })
    expect(rows.find((r) => r.id === "settings")?.cells).toMatchObject({ owner: true, manager: "sites", buyer: false, expediter: false })
  })

  it("the expediter never sees a price: only escalating and talking to the supplier are his", () => {
    const rows = roleRows(full)
    expect(rows.filter((r) => r.cells.expediter === true).map((r) => r.id)).toEqual(["escalate", "expedite"])
    expect(rows.find((r) => r.id === "prices")?.cells.expediter).toBe(false)
  })

  it("the buyer does everything but approve and set", () => {
    const rows = roleRows(full)
    expect(rows.filter((r) => r.cells.buyer === false).map((r) => r.id)).toEqual(["approve", "approve_over", "settings", "subscription"])
  })

  it("the owner who stepped back reads prices and approves only — and sets the policies and sees the subscription", () => {
    const rows = roleRows({ ...full, ownerStepsBack: true })
    expect(rows.filter((r) => r.cells.owner === true).map((r) => r.id)).toEqual(["prices", "approve", "approve_over", "raise_request", "settings", "subscription"])
  })

  it("the requester's column and «يرفع طلب مواد» exist only without Project Management", () => {
    expect(roleColumns({ pmOn: true })).not.toContain("requester")
    expect(roleColumns({ pmOn: false })).toContain("requester")
    expect(roleRows({ ...full, pmOn: true }).map((r) => r.id)).not.toContain("raise_request")
    const raise = roleRows(full).find((r) => r.id === "raise_request")
    expect(raise?.cells).toEqual({ owner: true, manager: true, buyer: true, expediter: false, requester: true })
  })

  it("«يدعو مورداً» is the manager's and the buyer's, as `mayInviteSuppliers` gates it — never the expediter's", () => {
    expect(roleRows(full).find((r) => r.id === "invite_suppliers")?.cells).toEqual({ owner: true, manager: true, buyer: true, expediter: false, requester: false })
    expect(roleRows({ ...full, ownerStepsBack: true }).find((r) => r.id === "invite_suppliers")?.cells.owner).toBe(false)
  })

  it("«يعلّم الدفع» shows without Finance and «يسأل الورشة» with Manufacturing", () => {
    expect(roleRows({ ...full, financeOn: false }).map((r) => r.id)).toContain("mark_paid")
    expect(roleRows(full).map((r) => r.id)).not.toContain("mark_paid")
    expect(roleRows({ ...full, mfgOn: true }).map((r) => r.id)).toContain("ask_workshop")
    expect(roleRows(full).map((r) => r.id)).not.toContain("ask_workshop")
  })
})

describe("the requester", () => {
  const holds = (...ids: PermissionId[]) => (p: PermissionId) => ids.includes(p)

  it("is a member who holds none of Procurement's permissions", () => {
    expect(isRequesterOnly(holds("projects.view"), false)).toBe(true)
    expect(isRequesterOnly(holds(), false)).toBe(true)
  })

  it("is nobody who holds one — the follower's po.expedite included — and never the owner", () => {
    for (const p of ["rfq.create", "rfq.manage", "offers.view", "offers.accept", "po.approve", "po.expedite", "suppliers.manage", "deliveries.confirm"] as const)
      expect({ p, requester: isRequesterOnly(holds(p), false) }).toEqual({ p, requester: false })
    expect(isRequesterOnly(holds(), true)).toBe(false)
  })
})
