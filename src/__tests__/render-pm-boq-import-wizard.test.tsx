/**
 * BOQ Import PM 1.0 — the new-project wizard: the BOQ step opens the same window as the project's own BOQ
 * (upload, the template or typing), holds what the window hands over, and writes it with the section and the
 * source on every line when the project is accepted.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("@/lib/pm/handover-writes", () => ({ ...jest.requireActual("@/lib/pm/handover-writes"), acceptHandover: jest.fn().mockResolvedValue({ projectId: "p9", projectNo: "PJ-2026/009" }) }))

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setSignedIn } from "@/test-utils/render-world"
import { AcceptHandoverWizard } from "@/components/pm/AcceptHandoverWizard"
import { acceptHandover } from "@/lib/pm/handover-writes"
import type { PmHandover } from "@/lib/pm/handover"

installDomShims()
jest.setTimeout(30000)

const HANDOVER: PmHandover = {
  id: "H1",
  organizationId: "own",
  status: "wait",
  to: "own",
  toName: "Owner",
  opportunityId: "opp1",
  contactId: null,
  title: "School",
  clientName: "Client",
  clientType: "company",
  kind: "bld",
  location: null,
  contractNumber: "C-1",
  value: 13872775,
  durationDays: 300,
  signedOn: "2026-10-01",
  startOn: "2026-11-01",
  advance: 0.1,
  retention: 0.05,
  note: null,
  requestedBy: "own",
  requestedByName: "Owner",
  createdAt: "2026-10-01T00:00:00Z",
  boq: [],
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {})
}

const bytesFile = (rel: string) => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "src", "test-utils", "fixtures", "boq-import", rel)))
  const f = new File([bytes], path.basename(rel))
  Object.defineProperty(f, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  return f
}

const toBoqStep = async () => {
  render(<AcceptHandoverWizard open onOpenChange={() => {}} handover={HANDOVER} actor={{ uid: "own", name: "Owner" }} />)
  await flush()
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  await flush()
}

beforeEach(() => {
  resetFakeDb()
  missingKeys.clear()
  setSignedIn("own")
  setLocale("en")
  seed("users/own", { organizationId: "own", organizationRole: "owner", name: "Owner" })
  ;(acceptHandover as jest.Mock).mockClear()
})

const nextButton = () => screen.getByRole("button", { name: "Next" })

async function upload(f: File) {
  fireEvent.change(screen.getByLabelText("BOQ file"), { target: { files: [f] } })
  await flush()
}

describe("the wizard's BOQ step", () => {
  it("opens the shared window, holds what it hands over, and writes the lines with their section and source", async () => {
    await toBoqStep()
    fireEvent.click(screen.getByRole("button", { name: /Upload Excel/ }))
    expect(nextButton()).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Upload the BOQ" }))
    await upload(bytesFile("samples/BOQ-3-Villa-Priced.xlsx"))
    expect(screen.getByText(/We read 48 items/)).toBeTruthy()
    expect(screen.getByText(/Matches the award value|Above the award value|Below the award value/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^Add 48 items to the BOQ/ }))
    await flush()

    expect(screen.getByText(/48 items entered/)).toBeTruthy()
    expect(nextButton()).toBeEnabled()
    fireEvent.click(nextButton())
    await flush()
    fireEvent.click(screen.getByRole("button", { name: "Accept & create the project" }))
    await flush()

    expect(acceptHandover).toHaveBeenCalledTimes(1)
    const input = (acceptHandover as jest.Mock).mock.calls[0][3]
    expect(input.source).toBe("xl")
    expect(input.lines).toHaveLength(48)
    expect(input.groups ?? []).toEqual([])
    expect(input.lines[0]).toMatchObject({ groupId: null, extra: { srcKind: "file", srcFile: "BOQ-3-Villa-Priced.xlsx", srcByName: "Owner" } })
    expect(input.lines[0].extra.divisionNameAr).not.toBe("")
    expect([...missingKeys]).toEqual([])
  })

  it("typed by hand: the window opens empty; a line with a negative quantity (an omission) is held like any other", async () => {
    await toBoqStep()
    fireEvent.click(screen.getByRole("button", { name: /Enter manually/ }))
    fireEvent.click(screen.getByRole("button", { name: "Enter the items by hand" }))
    expect(screen.getByText("No items yet — start with “+ Section” or “+ Item”.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Item" }))
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Omitted wall" } })
    fireEvent.change(screen.getByLabelText(/^Qty/), { target: { value: "-4" } })
    fireEvent.click(screen.getByRole("button", { name: "Correct, an omission" }))
    fireEvent.click(screen.getByRole("button", { name: /^Add 1 item to the BOQ/ }))
    await flush()
    expect(screen.getByText(/1 item entered/)).toBeTruthy()
    expect(nextButton()).not.toBeDisabled()
    expect(screen.queryByText(/negative quantity \(an omission\)/)).toBeNull()
  })

  it("a held BOQ is reopened with its own lines and can be replaced by another file", async () => {
    await toBoqStep()
    fireEvent.click(screen.getByRole("button", { name: /Upload Excel/ }))
    fireEvent.click(screen.getByRole("button", { name: "Upload the BOQ" }))
    await upload(bytesFile("samples/BOQ-4-English-Bills.xlsx"))
    fireEvent.click(screen.getByRole("button", { name: /^Add 38 items to the BOQ/ }))
    await flush()
    fireEvent.click(screen.getByRole("button", { name: "Review or edit the items" }))
    expect(screen.getByText("You are editing your current BOQ — it has no measurements yet")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Save the BOQ \(38 items\)/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Upload another file" }))
    expect(screen.getByText("Drop your BOQ file here")).toBeTruthy()
  })
})
