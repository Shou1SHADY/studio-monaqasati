/**
 * BOQ Import PM 1.0 — the window: upload a file as received, see what was read with the yellow lines,
 * settle them on the line and add; the template and the manual way end in the same window; the limits
 * and the old .xls are told in words.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale, setSignedIn } from "@/test-utils/render-world"
import { BoqImportDialog, type BoqImportDialogProps } from "@/components/pm/BoqImportDialog"
import type { BoqImportPayload } from "@/lib/pm/boq-import"

installDomShims()
jest.setTimeout(30000)

const FIX = path.join(process.cwd(), "src", "test-utils", "fixtures", "boq-import")

function withBuffer(bytes: Uint8Array, name: string): File {
  const f = new File([bytes], name)
  Object.defineProperty(f, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  return f
}

const fileOf = (rel: string): File => withBuffer(new Uint8Array(fs.readFileSync(path.join(FIX, rel))), path.basename(rel))
const textFile = (name: string, text: string): File => withBuffer(new TextEncoder().encode(text), name)

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {})
}

function mount(over: Partial<BoqImportDialogProps> = {}) {
  const onApply = jest.fn<Promise<unknown>, [BoqImportPayload]>().mockResolvedValue(undefined)
  const onOpenChange = jest.fn()
  render(<BoqImportDialog open mode="create" awardValue={13872775} onApply={onApply} onOpenChange={onOpenChange} {...over} />)
  return { onApply, onOpenChange }
}

async function upload(f: File) {
  fireEvent.change(screen.getByLabelText("BOQ file"), { target: { files: [f] } })
  await flush()
  await waitFor(() => expect(screen.queryByText("Reading the file…")).toBeNull())
}

const addButton = () => screen.getByRole("button", { name: /^(Add|Replace|Save)/ })

beforeEach(() => {
  missingKeys.clear()
  setSignedIn("own")
  setLocale("en")
})

describe("a file as received", () => {
  it("shows what was read with its yellow lines; they block adding until settled on the line; then it adds", async () => {
    const { onApply, onOpenChange } = mount()
    await upload(fileOf("boq-27/c22_arithmetic_errors.xlsx"))
    expect([...missingKeys]).toEqual([])

    expect(screen.getByText(/We read 22 items/)).toBeTruthy()
    expect(screen.getByText("2 need you")).toBeTruthy()
    expect(addButton()).toBeDisabled()
    expect(screen.getByText("2 items still need you")).toBeTruthy()
    expect(screen.getAllByText(/Your file says/)).toHaveLength(2)
    expect(screen.getByText(/The yellow items below explain it/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole("button", { name: "Use quantity × rate" })[0])
    expect(screen.getByText("1 item still needs you")).toBeTruthy()
    expect(addButton()).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /^Use your file amount/ }))
    expect(screen.queryByText(/Your file says/)).toBeNull()
    expect(addButton()).toBeEnabled()
    expect(addButton().textContent).toBe("Add 22 items to the BOQ")

    fireEvent.click(addButton())
    await flush()
    expect(onApply).toHaveBeenCalledTimes(1)
    const payload = onApply.mock.calls[0][0]
    expect(payload).toMatchObject({ source: "file", fileName: "c22_arithmetic_errors.xlsx", edit: false })
    expect(payload.lines).toHaveLength(22)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("the reconciliation: items → the file's own total → the award value, the award only a warning", async () => {
    mount({ awardValue: 1_000_000 })
    await upload(fileOf("samples/BOQ-3-Villa-Priced.xlsx"))
    expect(screen.getByText(/Matches your file total \(sheet/)).toBeTruthy()
    expect(screen.getByText(/Above the award value by .* — a warning, it does not block adding/)).toBeTruthy()
    expect(addButton()).toBeEnabled()
  })

  it("a negative quantity is asked about; confirming it as an omission settles it", async () => {
    const { onApply } = mount({ awardValue: null })
    await upload(fileOf("samples/BOQ-2-Messy-Contractor.xlsx"))
    expect(screen.getByText("Negative quantity.")).toBeTruthy()
    expect(screen.getByText("Unpriced BOQ")).toBeTruthy()
    expect(addButton()).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Correct, an omission" }))
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    await flush()
    expect(onApply.mock.calls[0][0].lines.every((l) => l.rate === null)).toBe(true)
  })

  it("what was left out is listed with its reason", async () => {
    mount()
    await upload(fileOf("boq-27/c20_hidden_old_revision.xlsx"))
    fireEvent.click(screen.getByRole("button", { name: /We skipped/ }))
    expect(screen.getAllByText(/hidden sheet — not read/).length).toBeGreaterThan(0)
  })

  it("removing a line lists it with «bring it back»; the count follows", async () => {
    mount()
    await upload(fileOf("samples/BOQ-3-Villa-Priced.xlsx"))
    expect(screen.getByText(/We read 48 items/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Do not add it" })[0])
    expect(screen.getByText(/We read 47 items/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /We skipped .*row/ }))
    fireEvent.click(screen.getByRole("button", { name: "Bring it back" }))
    expect(screen.getByText(/We read 48 items/)).toBeTruthy()
  })
})

describe("a big file", () => {
  it("3000 items are read at once but shown a page at a time, and still add in one go", async () => {
    const { onApply } = mount({ awardValue: null })
    await upload(fileOf("boq-27/c18_large.xlsx"))
    expect(screen.getByText(/We read 3000 items/)).toBeTruthy()
    expect(document.querySelectorAll("tbody tr:not([data-row-group])").length).toBeLessThanOrEqual(100)
    expect(addButton().textContent).toBe("Add 3000 items to the BOQ")
    fireEvent.click(addButton())
    await flush()
    expect(onApply.mock.calls[0][0].lines).toHaveLength(3000)
  })
})

describe("what cannot be read is told in words", () => {
  it("an old .xls asks to be saved as .xlsx, an unknown type says so, an empty file is empty", async () => {
    mount()
    await upload(textFile("old.xls", "x"))
    expect(screen.getByText(/old Excel file \(\.xls\)/)).toBeTruthy()
    await upload(textFile("letter.pdf", "x"))
    expect(screen.getByText(/This format cannot be read/)).toBeTruthy()
    await upload(textFile("empty.csv", "   \n"))
    expect(screen.getByText(/The file is empty\./)).toBeTruthy()
    expect(screen.getByRole("button", { name: /enter the items by hand/ })).toBeTruthy()
  })

  it("the template with no items under its headings says so", async () => {
    mount()
    await upload(fileOf("samples/Mdmak-BOQ-Template.xlsx"))
    expect(screen.getByText(/We found the header row but no items under it/)).toBeTruthy()
  })

  it("a file over the size limit is refused before it is read", async () => {
    mount()
    await upload(withBuffer(new Uint8Array(10 * 1048576 + 1), "big.csv"))
    expect(screen.getByText(/The file is larger than 10 MB\./)).toBeTruthy()
  })

  it("asks «help us once» only when the description or the quantity column is unknown, and reads again once chosen", async () => {
    const { onApply } = mount({ awardValue: null })
    await upload(textFile("lone.csv", "x1,حفر وردم,5000\nx2,خرسانة مسلحة,12000\nx3,حديد تسليح,8000\n"))
    expect(screen.getByText(/Help us once/)).toBeTruthy()
    expect(screen.getByText(/holds the quantity/)).toBeTruthy()
    const qty = screen.getByLabelText(/^Quantity/)
    const options = within(qty).getAllByRole("option")
    fireEvent.change(qty, { target: { value: options[options.length - 1].getAttribute("value") } })
    await flush()
    expect(screen.queryByText(/Help us once/)).toBeNull()
    expect(screen.getByText(/We read 3 items/)).toBeTruthy()
    fireEvent.click(addButton())
    await flush()
    expect(onApply.mock.calls[0][0].lines.map((l) => l.quantity)).toEqual([5000, 12000, 8000])
  })
})

describe("the template and the hand way", () => {
  it("the template downloads as a real .xlsx", async () => {
    const created: Blob[] = []
    Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: () => {} })
    const named: string[] = []
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      named.push(this.download)
    })
    mount()
    fireEvent.click(screen.getByRole("button", { name: /Download the Mdmak BOQ template/ }))
    expect(named).toEqual(["Mdmak-BOQ-Template.xlsx"])
    expect(created[0].type).toContain("spreadsheetml")
    expect(created[0].size).toBeGreaterThan(1000)
    click.mockRestore()
  })

  it("by hand: «+ Item» opens the line to fill; no description or quantity is yellow; the amount is computed; then it adds", async () => {
    const { onApply } = mount()
    fireEvent.click(screen.getByRole("button", { name: /enter the items by hand/ }))
    expect(screen.getByText("Enter the items by hand.")).toBeTruthy()
    expect(screen.getByText("No items yet — start with “+ Section” or “+ Item”.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Item" }))
    expect(screen.getByText("Write the item description with ✎.")).toBeTruthy()
    expect(screen.getByText("Enter the item's quantity, or remove it.")).toBeTruthy()
    expect(addButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Blinding concrete C15" } })
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "01-01" } })
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "م³" } })
    fireEvent.change(screen.getByLabelText(/^Qty/), { target: { value: "22" } })
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: "230" } })
    expect(screen.getByText("5,060")).toBeTruthy()
    expect(addButton().textContent).toBe("Add 1 item to the BOQ")
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    await flush()
    expect(onApply.mock.calls[0][0]).toMatchObject({
      source: "manual",
      fileName: null,
      edit: false,
      lines: [{ code: "01-01", descriptionAr: "Blinding concrete C15", descriptionEn: "Blinding concrete C15", unit: "م³", quantity: 22, rate: 230, section: null }],
    })
  })

  it("«+ Section» adds the heading and a line under it, and the section can be named", async () => {
    const { onApply } = mount()
    fireEvent.click(screen.getByRole("button", { name: /enter the items by hand/ }))
    fireEvent.click(screen.getByRole("button", { name: "Section" }))
    fireEvent.change(screen.getByPlaceholderText("Code"), { target: { value: "01" } })
    fireEvent.change(screen.getByPlaceholderText("Section name"), { target: { value: "Concrete works" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Done" })[0])
    expect(document.querySelector("[data-row-group]")?.textContent).toContain("01 · Concrete works")
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Plain concrete" } })
    fireEvent.change(screen.getByLabelText(/^Qty/), { target: { value: "3" } })
    fireEvent.click(addButton())
    await flush()
    const payload = onApply.mock.calls[0][0]
    expect(payload.sections).toEqual([{ key: expect.any(String), code: "01", text: "Concrete works" }])
    expect(payload.lines[0].section).toBe(payload.sections[0].key)
    expect(payload.lines[0].rate).toBeNull()
  })
})

describe("the current BOQ reopened", () => {
  const current = [
    { id: "a", code: "01-01", descriptionAr: "حفر", descriptionEn: "Excavation", unit: "م³", quantity: 10, rate: 5, divisionNo: "01", divisionName: "الأعمال الترابية", sheet: "", row: null },
    { id: "b", code: "01-02", descriptionAr: "ردم", descriptionEn: "ردم", unit: "م³", quantity: 4, rate: 0, divisionNo: "01", divisionName: "الأعمال الترابية", sheet: "", row: null },
  ]

  it("opens straight on the lines, saves with «Save the BOQ», and names the lines it keeps", async () => {
    const { onApply } = mount({ mode: "edit", current, currentCount: 2 })
    expect(screen.getByText("You are editing your current BOQ — it has no measurements yet")).toBeTruthy()
    expect(screen.getByText("01 · الأعمال الترابية")).toBeTruthy()
    expect(addButton().textContent).toBe("Save the BOQ (2 items)")
    expect(screen.getByText("Your edit is saved to the current BOQ — it has no measurements yet.")).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText(/^Qty/)[0], { target: { value: "12" } })
    fireEvent.click(addButton())
    await flush()
    const payload = onApply.mock.calls[0][0]
    expect(payload.edit).toBe(true)
    expect(payload.lines.map((l) => [l.existingId, l.quantity])).toEqual([
      ["a", 12],
      ["b", 4],
    ])
  })

  it("replacing says what is replaced", async () => {
    mount({ mode: "replace", currentCount: 2 })
    await upload(fileOf("samples/BOQ-3-Villa-Priced.xlsx"))
    expect(addButton().textContent).toBe("Replace the BOQ with 48 items")
    expect(screen.getByText("Your current BOQ (2 items) is replaced — it has no measurements yet.")).toBeTruthy()
  })
})

describe("the save is refused", () => {
  it("keeps the window open with the work in it", async () => {
    const { onApply, onOpenChange } = mount({
      mode: "edit",
      current: [{ id: "a", code: "1", descriptionAr: "حفر", descriptionEn: "حفر", unit: "م³", quantity: 1, rate: 1, divisionNo: "", divisionName: "", sheet: "", row: null }],
    })
    onApply.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "BLOCKED", blocks: ["measured"] }))
    fireEvent.click(addButton())
    await flush()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(addButton()).toBeEnabled()
    expect([...missingKeys]).toEqual([])
  })
})

describe("in Arabic", () => {
  it("is titled as the prototype words it, and the drop zone reads the limits", () => {
    setLocale("ar")
    mount()
    expect(screen.getByText("ارفع جدول الكميات")).toBeTruthy()
    expect(screen.getByText("اسحب ملف جدول الكميات هنا")).toBeTruthy()
    expect(screen.getByText(/حتى 10 م\.ب/)).toBeTruthy()
    expect([...missingKeys]).toEqual([])
  })
})
