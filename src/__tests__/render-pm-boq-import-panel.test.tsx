/**
 * BOQ Import PM 1.0 — the project's BOQ panel: the owner and the project manager upload, enter and edit
 * by hand while the project is planning and nothing is measured; the site engineer only views; after an
 * approved measurement there is no upload and no hand edit — a change order only.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("@/lib/pm/boq-import-writes", () => ({ submitBoqImport: jest.fn().mockResolvedValue({ written: 2, removed: 0 }) }))

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setSignedIn } from "@/test-utils/render-world"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, pmCan, pmCeiling, pmRefusal, type PmContext } from "@/lib/pm/access"
import { PmBoqPanel } from "@/components/pm/PmBoqPanel"
import { submitBoqImport } from "@/lib/pm/boq-import-writes"

installDomShims()
jest.setTimeout(30000)

const accessOf = (ctx: PmContext): PmAccess => ({
  ctx,
  uid: "u1",
  isLoading: false,
  duties: effectiveDuties(ctx.ceiling, ctx.seat),
  allowed: (a) => pmRefusal(ctx, a) === null,
  refusal: (a) => pmRefusal(ctx, a),
  has: (k) => pmCan(ctx, k),
})

const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const manager: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "u1", role: "pm" }, archived: false }
const siteEngineer: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "u1", role: "site" }, archived: false }
const actor = { uid: "u1", name: "Reem" }

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => {})
}

const panel = (ctx: PmContext, planning = true) => render(<PmBoqPanel projectId="p1" orgId="own" contractValue={4000} access={accessOf(ctx)} actor={actor} planning={planning} />)

const line = (id: string, over: Record<string, unknown> = {}) =>
  seed(`projects/p1/boqItems/${id}`, {
    itemNo: id === "a" ? "01-01" : "01-02",
    descriptionAr: id === "a" ? "حفر" : "ردم",
    descriptionEn: id === "a" ? "Excavation" : "ردم",
    unit: "م³",
    quantity: 10,
    unitPrice: 20,
    executedQuantity: 0,
    billedQuantity: 0,
    divisionNo: "01",
    divisionNameAr: "01 · الأعمال الترابية",
    srcKind: "file",
    srcFile: "boq.xlsx",
    srcByName: "Reem",
    srcDay: "2026-10-20",
    ...over,
  })

beforeEach(() => {
  resetFakeDb()
  missingKeys.clear()
  setSignedIn("u1")
  setLocale("en")
  seed("users/u1", { organizationId: "own", organizationRole: "owner" })
  seed("projects/p1", { organizationId: "own", status: "working", pm: { no: "PJ-2026/014", lifecycle: "plan" } })
  ;(submitBoqImport as jest.Mock).mockClear()
})

describe("an empty BOQ", () => {
  it("the owner uploads it or adds the items by hand — both open the same window", async () => {
    panel(owner)
    await flush()
    expect(screen.getByText("No bill of quantities yet")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Upload the BOQ" }))
    expect(screen.getByText("Drop your BOQ file here")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "or add items by hand" }))
    expect(screen.getByText("Enter the items by hand.")).toBeTruthy()
    expect([...missingKeys]).toEqual([])
  })

  it("the project manager does too; the site engineer only views, and is told why", async () => {
    const { unmount } = panel(manager)
    await flush()
    expect(screen.getByRole("button", { name: "Upload the BOQ" })).toBeTruthy()
    unmount()
    panel(siteEngineer)
    await flush()
    expect(screen.queryByRole("button", { name: "Upload the BOQ" })).toBeNull()
    expect(screen.queryByRole("button", { name: "or add items by hand" })).toBeNull()
    expect(screen.getByText("Uploading the BOQ is for whoever prepares the contract. Your role cannot.")).toBeTruthy()
  })

  it("once started, nothing is uploaded: the older message stays", async () => {
    panel(owner, false)
    await flush()
    expect(screen.queryByRole("button", { name: "Upload the BOQ" })).toBeNull()
  })
})

describe("a BOQ before any approved measurement", () => {
  beforeEach(() => {
    line("a")
    line("b")
  })

  it("shows its source and offers another file or a hand edit", async () => {
    panel(owner)
    await flush()
    expect(screen.getByText(/From “boq\.xlsx” — uploaded by Reem/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Upload another file" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit the items by hand" })).toBeTruthy()
    expect(screen.queryByText(/approved measurements/)).toBeNull()
  })

  it("«Edit the items by hand» reopens the current lines and saves them through the server with their ids", async () => {
    panel(owner)
    await flush()
    fireEvent.click(screen.getByRole("button", { name: "Edit the items by hand" }))
    expect(screen.getByText("You are editing your current BOQ — it has no measurements yet")).toBeTruthy()
    expect(screen.getByText("01 · الأعمال الترابية")).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText(/^Qty/)[0], { target: { value: "11" } })
    fireEvent.click(screen.getByRole("button", { name: /^Save the BOQ/ }))
    await flush()
    expect(submitBoqImport).toHaveBeenCalledTimes(1)
    const [projectId, payload] = (submitBoqImport as jest.Mock).mock.calls[0]
    expect(projectId).toBe("p1")
    expect(payload).toMatchObject({ edit: true })
    expect(payload.lines.map((l: { existingId: string }) => l.existingId).sort()).toEqual(["a", "b"])
    expect(payload.lines.find((l: { existingId: string }) => l.existingId === "a")).toMatchObject({ quantity: 11, rate: 20 })
  })

  it("the site engineer sees the BOQ and no way to change it", async () => {
    panel(siteEngineer)
    await flush()
    expect(screen.queryByRole("button", { name: "Upload another file" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit the items by hand" })).toBeNull()
  })
})

describe("after an approved measurement", () => {
  it("there is no upload and no hand edit — a change order only, with the way to it", async () => {
    line("a", { executedQuantity: 4 })
    line("b")
    panel(owner)
    await flush()
    expect(screen.queryByRole("button", { name: "Upload another file" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit the items by hand" })).toBeNull()
    expect(screen.getByText(/The BOQ has approved measurements \(1 item\)/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open change orders" }).getAttribute("href")).toBe("/contractor/projects/p1?tab=pmVo")
  })

  it("a started project says so", async () => {
    line("a")
    panel(owner, false)
    await flush()
    expect(screen.queryByRole("button", { name: "Edit the items by hand" })).toBeNull()
    expect(screen.getByText(/The project has started/)).toBeTruthy()
  })
})

describe("in Arabic", () => {
  it("reads the prototype's words", async () => {
    setLocale("ar")
    panel(owner)
    await flush()
    expect(screen.getByText("لا جدول كميات بعد")).toBeTruthy()
    expect(screen.getByRole("button", { name: "ارفع جدول الكميات" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "أو أضف البنود يدوياً" })).toBeTruthy()
    expect([...missingKeys]).toEqual([])
  })
})
