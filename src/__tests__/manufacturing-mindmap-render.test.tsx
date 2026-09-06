import { render, screen, fireEvent } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { ManufacturingMindMap } from "@/components/manufacturing/ManufacturingMindMap"
import type { WorkOrder } from "@/lib/manufacturing"

// next-intl ships ESM only, which Jest does not transform — resolve the real
// message files through a tiny stand-in so the copy under test is the copy
// that ships.
let mockLocale: "ar" | "en" = "ar"
const mockMessages = (locale: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8"))

// jest.setup.ts mocks lucide-react as an empty module, which would leave every
// icon undefined; stub the ones the map draws so the cards can render.
jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("svg", { "data-icon": name, "aria-hidden": props["aria-hidden"] })
  return Object.fromEntries(
    ["Factory", "Warehouse", "ClipboardList", "CheckCircle2", "CircleDot", "Circle", "PackageCheck", "Truck", "ZoomIn", "ZoomOut", "Maximize", "Move"].map((n) => [n, icon(n)])
  )
})

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) => {
    const table = namespace
      .split(".")
      .reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    let text = typeof table?.[key] === "string" ? (table[key] as string) : `${namespace}.${key}`
    for (const [name, value] of Object.entries(vars || {})) text = text.replace(`{${name}}`, String(value))
    return text
  },
}))

const warehouses = [
  { id: "central", name: "المستودع المركزي", isCentral: true },
  { id: "site", name: "مستودع الموقع", projectId: "p1" },
]

const orders: WorkOrder[] = [
  {
    id: "wo-1",
    organizationId: "org",
    orderNumber: 1,
    title: "أبواب حديد",
    items: [],
    sourceWarehouseId: "central",
    sourceWarehouseName: "المستودع المركزي",
    output: { name: "باب حديد", quantity: 4, unit: "قطعة" },
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [
      { departmentId: "d1", departmentName: "التصميم", assigneeUserId: "u1", assigneeName: "أحمد", status: "in_progress", startedAt: null, completedAt: null, note: null },
      { departmentId: "d2", departmentName: "اللحام", assigneeUserId: null, assigneeName: null, status: "pending", startedAt: null, completedAt: null, note: null },
    ],
    createdByUserId: "u1",
    createdByUserName: "أحمد",
  },
]

function renderMap(locale: "ar" | "en", list: WorkOrder[], onSelect = jest.fn()) {
  mockLocale = locale
  const utils = render(<ManufacturingMindMap orders={list} warehouses={warehouses} onSelectOrder={onSelect} />)
  return { ...utils, onSelect }
}

const leftOf = (el: HTMLElement) => parseFloat(el.style.left)

describe("ManufacturingMindMap", () => {
  it("draws the whole journey for an order and opens it from any node", () => {
    const { onSelect } = renderMap("ar", orders)
    expect(screen.getByTitle("التصنيع")).toBeInTheDocument()
    expect(screen.getByTitle("المستودع المركزي")).toBeInTheDocument()
    expect(screen.getByTitle("#1 أبواب حديد")).toBeInTheDocument()
    expect(screen.getByTitle("التصميم")).toBeInTheDocument()
    expect(screen.getByTitle("اللحام")).toBeInTheDocument()
    expect(screen.getByTitle("باب حديد")).toBeInTheDocument()
    expect(screen.getByText("تُحدَّد الوجهة بعد اكتمال التصنيع")).toBeInTheDocument()
    expect(screen.getByText("أوامر التشغيل: 1")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle("باب حديد"))
    expect(onSelect).toHaveBeenCalledWith("wo-1")
    fireEvent.click(screen.getByTitle("التصميم"))
    expect(onSelect).toHaveBeenCalledTimes(2)
    // Sources and the root are context, not links.
    expect(screen.getByTitle("المستودع المركزي").tagName).toBe("DIV")
    expect(screen.getByTitle("باب حديد").tagName).toBe("BUTTON")
  })

  it("puts the root on the right in Arabic and on the left in English", () => {
    const ar = renderMap("ar", orders)
    expect(leftOf(screen.getByTitle("التصنيع"))).toBeGreaterThan(leftOf(screen.getByTitle("#1 أبواب حديد")))
    ar.unmount()

    renderMap("en", orders)
    expect(leftOf(screen.getByTitle("Manufacturing"))).toBeLessThan(leftOf(screen.getByTitle("#1 أبواب حديد")))
    expect(screen.getByText("Destination chosen after completion")).toBeInTheDocument()
  })

  it("exposes zoom controls with accessible names", () => {
    renderMap("en", orders)
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Fit to view" })).toBeInTheDocument()
  })

  it("shows the shared empty state when there is nothing to draw", () => {
    renderMap("ar", [])
    expect(screen.getByText(mockMessages("ar").Portal ? ((mockMessages("ar").Portal as Record<string, Record<string, string>>).Shared.mfg_empty_orders) : "")).toBeInTheDocument()
    expect(screen.queryByTitle("التصنيع")).not.toBeInTheDocument()
  })
})
