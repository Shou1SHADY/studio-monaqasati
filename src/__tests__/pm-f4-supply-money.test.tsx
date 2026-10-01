/**
 * PM 1.0 — Supply & money parity (V4-pm-supply-money-01…06): the project's PO
 * table reads what Finance paid on each order (money holders only), the price
 * table compares the last price with the items' estimate, a store-issued line
 * reads «خرجت من …» and sorts first, and each indirect kind shows its paid part.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)

import React from "react"
import { render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, setSignedIn } from "@/test-utils/render-world"
import type { PmAccess } from "@/hooks/usePmAccess"
import { indirectPaid } from "@/lib/pm/indirect"
import { materialKeyOf } from "@/lib/pm/store"
import { awaitingReceipt, priceVsEstimate, type PmMaterialRequest, type ReqLine } from "@/lib/pm/supply"
import { ProjectPurchasingPanel } from "@/components/pm/ProjectPurchasingPanel"

installDomShims()

describe("priceVsEstimate (price table «فوق/تحت تقديرك»)", () => {
  const est = (id: string) => ({ i1: 100, i2: 200 })[id] ?? 0
  const line = (name: string, unit: string, quantity: number, boqItemId: string | null, cancelled = 0) => ({ name, unit, quantity, cancelled, boqItemId })

  it("weighs the estimate of the items the material was ordered for", () => {
    const lines = [line("حديد 12مم", "طن", 10, "i1"), line("حديد ١٢مم", "طن", 10, "i2"), line("اسمنت", "كيس", 5, "i1")]
    expect(priceVsEstimate(165, materialKeyOf("حديد 12مم", "طن"), lines, est)).toBe(10)
  })

  it("is null when no order line names an estimated item, or nothing is left of it", () => {
    const key = materialKeyOf("رمل", "م3")
    expect(priceVsEstimate(50, key, [line("رمل", "م3", 10, null)], est)).toBeNull()
    expect(priceVsEstimate(50, key, [line("رمل", "م3", 10, "i1", 10)], est)).toBeNull()
    expect(priceVsEstimate(90, key, [line("رمل", "م3", 10, "i1")], est)).toBe(-10)
  })
})

describe("awaitingReceipt («بانتظار الاستلام»)", () => {
  const ln = (over: Partial<ReqLine>): ReqLine => ({ itemId: "i1", code: "A1", key: "k", name: "m", unit: "u", qty: 10, ...over })
  const rq = (id: string, needBy: string, lines: ReqLine[], extra: Partial<PmMaterialRequest> = {}): PmMaterialRequest => ({ id, title: id, needBy, lines, status: "approved", requestedByUserId: "u", ...extra })

  it("puts what a main store issued first, then by need-by, and flags it", () => {
    const rows = awaitingReceipt([
      rq("a", "2026-10-01", [ln({})], { poId: "po1" }),
      rq("b", "2026-12-01", [ln({ inv: { k: "issue", q: 10, warehouseName: "المستودع المركزي", on: "2026-09-20" } })]),
      rq("c", "2026-09-30", [ln({})], { mfgRequestId: "m1" }),
      rq("d", "2026-09-01", [ln({})], { status: "pending" }),
    ])
    expect(rows.map((x) => [x.r.id, x.left])).toEqual([
      ["b", true],
      ["c", false],
      ["a", false],
    ])
  })
})

describe("indirectPaid («مدفوع» per indirect kind)", () => {
  it("counts cash credited in a voucher, and a payroll only as far as its transfers settle it", () => {
    const paid = indirectPaid(
      "p1",
      [
        { sourceType: "manual_voucher", status: "posted", lines: [{ account: "510501", debit: 4_000, project: "p1" }, { account: "110102", credit: 4_000 }] },
        { sourceType: "manual_voucher", status: "posted", lines: [{ account: "520301", debit: 1_000, project: "p1" }, { account: "210101", credit: 1_000 }] },
        { sourceType: "manual_voucher", status: "reversed", lines: [{ account: "510501", debit: 9_000, project: "p1" }, { account: "110101", credit: 9_000 }] },
        { sourceType: "hr_pay", sourceId: "hr:PAY:2026-08", status: "posted", lines: [{ account: "510201", debit: 30_000, project: "p1" }, { account: "510201", debit: 10_000, project: "p2" }, { account: "210202", credit: 36_000 }, { account: "210204", credit: 4_000 }] },
        { sourceType: "hr_pay", sourceId: "hr:PAY:2026-09", status: "posted", lines: [{ account: "510201", debit: 20_000, project: "p1" }, { account: "210202", credit: 20_000 }] },
      ],
      [
        { sourceType: "hr_pay_payment", sourceId: "2026-08", status: "posted", lines: [{ account: "210202", debit: 30_000 }, { account: "110102", credit: 30_000 }] },
        { sourceType: "hr_pay_return", sourceId: "2026-08:3", status: "posted", lines: [{ account: "110102", debit: 2_000 }, { account: "210202", credit: 2_000 }] },
        { sourceType: "hr_pay_payment", sourceId: "2026-08:held:3", status: "posted", lines: [{ account: "210202", debit: 2_000 }, { account: "110102", credit: 2_000 }] },
      ]
    )
    expect(paid).toEqual({ stf: 22_500, eq: 0, ovh: 4_000, ins: 0 })
  })
})

describe("the project's PO table — «مدفوع» from Finance", () => {
  beforeEach(() => {
    resetFakeDb()
    setSignedIn("own")
    seed("purchaseOrders/po1", {
      organizationId: "own",
      projectId: "P1",
      docNumber: "PO-2026/014",
      status: "sent",
      supplierName: "مورّد",
      vatRate: 0.15,
      createdAt: "2026-09-01T09:00:00Z",
      lines: [{ name: "حديد", unit: "طن", quantity: 10, unitPrice: 3_000, accepted: 0, cancelled: 0, rejected: 0, held: 0 }],
      financePayments: [
        { no: "PAY-1", kind: "adv", amount: 10_000, valueDate: "2026-09-02", reference: "r1", byName: "م", at: "2026-09-02T09:00:00Z" },
        { no: "PAY-2", kind: "part", amount: 2_345, valueDate: "2026-09-10", reference: "r2", byName: "م", at: "2026-09-10T09:00:00Z" },
      ],
    })
  })

  const access = (money: boolean) => ({ has: (k: string) => money && k === "money" }) as unknown as PmAccess

  it("shows what Finance paid on each order to a money holder", () => {
    const { container } = render(<ProjectPurchasingPanel projectId="P1" orgId="own" items={[]} startOn={null} access={access(true)} withPrices={false} />)
    expect(container.textContent).toContain("12,345")
  })

  it("shows no amount to a role without money", () => {
    const { container } = render(<ProjectPurchasingPanel projectId="P1" orgId="own" items={[]} startOn={null} access={access(false)} withPrices={false} />)
    expect(container.textContent).not.toContain("12,345")
  })
})
