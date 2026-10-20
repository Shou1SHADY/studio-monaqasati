/**
 * PUR-04 in Project Management (PUR-09 «ما يبقى»): PM's material request keeps its line per BOQ
 * item and its sample gate; only the NEW material is picked the Procurement way — searched in
 * the material tree, its name and unit taken with it — or typed as is.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { indexTree } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"

const mockMessages = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", "ar.json"), "utf8"))
const mockIndex = indexTree((JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile).roots)

jest.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: (namespace: string) => (key: string) => {
    const node = [...namespace.split("."), ...key.split(".")].reduce<unknown>((n, part) => (n as Record<string, unknown> | undefined)?.[part], mockMessages)
    return typeof node === "string" ? node : `MISSING:${namespace}.${key}`
  },
}))
jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("@/hooks/useMaterialTree", () => ({ useMaterialTree: () => ({ index: mockIndex, loading: false }) }))
jest.mock("@/firebase", () => ({ useFirestore: () => null, useCollection: () => ({ data: null }), useMemoFirebase: (f: () => unknown) => f(), useDoc: () => ({ data: null }) }))

import { TreeMaterialField } from "@/components/pm/SupplyDialogs"

describe("PM's new material comes from the tree", () => {
  it("a search hit fills the name and the tree's unit", () => {
    const onChange = jest.fn()
    render(<TreeMaterialField name="" units={["طن", "حبة"]} onChange={onChange} />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "اسياخ حديد" } })
    fireEvent.click(screen.getAllByRole("option")[0])
    const patch = onChange.mock.calls[0][0] as { name: string; unit?: string; unitOther?: boolean }
    expect(patch.name).toContain("اسياخ حديد التسليح")
    expect(patch.unit).toBeTruthy()
    expect(patch.unitOther).toBe(!["طن", "حبة"].includes(patch.unit as string))
  })
  it("words kept as they are stay a free-text name", () => {
    const onChange = jest.fn()
    render(<TreeMaterialField name="" units={["طن"]} onChange={onChange} />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "مادة خاصة جداً" } })
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith({ name: "مادة خاصة جداً" })
  })
  it("once picked the name is shown, and «غيّرها» clears it for a new search", () => {
    const onChange = jest.fn()
    render(<TreeMaterialField name="اسياخ حديد التسليح" units={["طن"]} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "غيّرها" }))
    expect(onChange).toHaveBeenCalledWith({ name: "" })
  })
})
