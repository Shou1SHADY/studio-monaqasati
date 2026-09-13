import { render, screen, fireEvent, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { ACC } from "@/lib/accounting/accounts"
import { buildEntry, type JournalEntry } from "@/lib/accounting/journal"
import { periodWindows } from "@/lib/accounting/balances"
import { balanceSheetTree, incomeStatementTree } from "@/lib/accounting/statement-tree"
import { cashConversionCycle } from "@/lib/accounting/analytics"
import { setAccountingPrefs } from "@/hooks/useAccountingPrefs"
import { StatementTreeTable } from "@/components/accounting/StatementTreeTable"
import { CashConversionCycleCard } from "@/components/accounting/LockedCashView"

let mockLocale: "ar" | "en" = "en"
const mockMessages = (locale: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8"))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] }),
    }
  )
})

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) => {
    const table = namespace
      .split(".")
      .reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    let text = typeof table?.[key] === "string" ? (table[key] as string) : `MISSING:${namespace}.${key}`
    for (const [name, value] of Object.entries(vars || {})) text = text.replace(`{${name}}`, String(value))
    return text
  },
}))

// The CCC card lives beside the Locked Cash screen, which reads the ledger
// through Firebase; nothing here touches it.
jest.mock("@/hooks/useAccounting", () => ({ useAccounting: () => ({}) }))
jest.mock("@/i18n/routing", () => ({ Link: () => null, usePathname: () => "/", useRouter: () => ({}) }))
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, isLoading: false }) }))

let n = 0
const e = (date: string, lines: Array<{ account: string; debit?: number; credit?: number; party?: string }>): JournalEntry => ({
  id: `e${++n}`,
  ...buildEntry({ organizationId: "o", date, kind: "auto", sourceType: "manual_voucher", sourceId: `s${n}`, description: "d", lines, entryNumber: n, userId: "u", userName: "U", defaultCostCenter: "C3" }),
})

const ENTRIES = [
  e("2026-01-01", [{ account: ACC.bankMain, debit: 100_000 }, { account: ACC.paidInCapital, credit: 100_000 }]),
  e("2026-02-01", [{ account: ACC.inventoryMaterials, debit: 30_000 }, { account: ACC.suppliersPayable, credit: 30_000 }]),
  e("2026-03-01", [{ account: ACC.clientsReceivable, debit: 12_000 }, { account: ACC.sundryIncome, credit: 12_000 }]),
  e("2026-03-02", [{ account: ACC.costMaterials, debit: 6_000 }, { account: ACC.inventoryMaterials, credit: 6_000 }]),
]
const WINDOWS = periodWindows(ENTRIES, "2026-01-01", "2026-12-31")

beforeEach(() => {
  mockLocale = "en"
  setAccountingPrefs({ scale: "units" })
})

describe("StatementTreeTable", () => {
  it("renders every label from the message files, expands, collapses and drills down", () => {
    const { nodes } = incomeStatementTree(WINDOWS.movement)
    const onSelect = jest.fn()
    const { container } = render(<StatementTreeTable nodes={nodes} onSelect={onSelect} />)
    expect(container.textContent).not.toContain("MISSING:")

    // Groups open by default: the revenue subtotal row is visible, accounts are not.
    expect(screen.getByText("Total revenue")).toBeInTheDocument()
    expect(screen.queryByText(ACC.sundryIncome)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }))
    expect(screen.getByText(ACC.sundryIncome)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }))
    expect(screen.queryByText("Total revenue")).not.toBeInTheDocument()
    // A collapsed group still carries its figure.
    const revenueRow = screen.getByText("Revenue").closest("tr")!
    expect(within(revenueRow).getByText("12,000.00")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expand Revenue" }))
    fireEvent.click(screen.getByRole("button", { name: "Show the accounts behind Other income" }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ labelEn: "Other income", codes: ["42"], value: 12_000 }))
  })

  it("honours the display scale", () => {
    setAccountingPrefs({ scale: "thousands" })
    const { nodes } = balanceSheetTree(WINDOWS.closing)
    render(<StatementTreeTable nodes={nodes} />)
    // Total assets 136,000 → 136.0 in thousands.
    expect(screen.getAllByText("136.0").length).toBeGreaterThan(0)
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { nodes } = balanceSheetTree(WINDOWS.closing)
    const { container } = render(<StatementTreeTable nodes={nodes} onSelect={() => {}} />)
    expect(container.textContent).not.toContain("MISSING:")
    expect(screen.getByRole("button", { name: "توسيع الكل" })).toBeInTheDocument()
  })
})

describe("CashConversionCycleCard", () => {
  it("shows DSO, DIO, DPO and the cash gap", () => {
    const ccc = cashConversionCycle(WINDOWS, 365)
    const { container } = render(<CashConversionCycleCard ccc={ccc} />)
    expect(container.textContent).not.toContain("MISSING:")
    expect(screen.getByText("Days sales outstanding")).toBeInTheDocument()
    expect(screen.getByText("Days inventory outstanding")).toBeInTheDocument()
    expect(screen.getByText("Days payables outstanding")).toBeInTheDocument()
    expect(container.textContent).toContain(String(Math.round(ccc.ccc!)))
  })

  it("explains when the period has nothing to measure", () => {
    const empty = cashConversionCycle(periodWindows(ENTRIES, "2025-01-01", "2025-01-31"), 31)
    render(<CashConversionCycleCard ccc={empty} />)
    expect(screen.getByText(/pick a longer period/)).toBeInTheDocument()
  })
})
