jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

/**
 * PUR-06 — the receivers' register: a person once, the role from the Arabic list (not free text),
 * a Saudi mobile written one way.
 */

import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { listCollection, resetFakeDb } from "@/test-utils/fake-firestore"
import { ReceiverRegister } from "@/components/procurement/ReceiverRegister"
import { RECEIVER_ROLES, type ProcReceiver } from "@/lib/procurement/receivers"
import type { ProcActor } from "@/lib/procurement/types"
import ar from "../../messages/ar.json"

installDomShims()
jest.setTimeout(30_000)

const ORG = "own"
const t = (ar as unknown as { Portal: { ProcReceivers: { role: Record<string, string>; dialog: Record<string, string>; err: Record<string, string>; add: string } } }).Portal.ProcReceivers
const owner: ProcActor = { uid: ORG, name: "المالك", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const existing = (over: Partial<ProcReceiver> = {}): ProcReceiver => ({
  id: "r1",
  organizationId: ORG,
  name: "أحمد العتيبي",
  title: "أمين المستودع",
  role: "warehouse_keeper",
  module: "inventory",
  phone: "0551002210",
  userId: null,
  warehouseIds: ["w1"],
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdById: ORG,
  ...over,
})

const open = async (receivers: ProcReceiver[] = []) => {
  render(<ReceiverRegister receivers={receivers} warehouses={[{ id: "w1", name: "المستودع المركزي" }]} actor={owner} orgId={ORG} mayEdit />)
  fireEvent.click(screen.getByRole("button", { name: t.add }))
  await flush()
}
const name = () => screen.getByLabelText(t.dialog.name) as HTMLInputElement
const phone = () => screen.getByLabelText(t.dialog.phone) as HTMLInputElement
const role = () => screen.getByLabelText(t.dialog.role) as HTMLSelectElement
const save = () => screen.getByRole("button", { name: t.dialog.save }) as HTMLButtonElement

beforeEach(() => {
  resetFakeDb()
  setSignedIn(ORG)
  missingKeys.clear()
})

it("asks for the role from the list — every option an Arabic word, none of them free text", async () => {
  await open()
  expect(role().tagName).toBe("SELECT")
  const options = Array.from(role().options).map((o) => o.textContent)
  expect(options).toEqual([t.dialog.rolePlaceholder, ...RECEIVER_ROLES.map((r) => t.role[r])])
  expect(missingKeys.size).toBe(0)
})

it("cannot be saved until a role, a name and a Saudi mobile are given", async () => {
  await open()
  expect(save().disabled).toBe(true)
  fireEvent.change(name(), { target: { value: "ماجد السالم" } })
  fireEvent.change(phone(), { target: { value: "+971551002210" } })
  await flush()
  expect(screen.getByText(t.dialog.phoneInvalid)).toBeTruthy()
  expect(save().disabled).toBe(true)
  fireEvent.change(phone(), { target: { value: "0551002210" } })
  expect(save().disabled).toBe(true)
  fireEvent.change(role(), { target: { value: "site_engineer" } })
  await flush()
  expect(save().disabled).toBe(false)
})

it("writes the mobile one way and the role's Arabic title", async () => {
  await open()
  fireEvent.change(name(), { target: { value: "ماجد السالم" } })
  fireEvent.change(role(), { target: { value: "site_engineer" } })
  fireEvent.change(phone(), { target: { value: "+966 55 100 2210" } })
  fireEvent.blur(phone())
  await flush()
  expect(phone().value).toBe("0551002210")
  fireEvent.click(save())
  await waitFor(() => expect(listCollection<Record<string, unknown>>("procurementReceivers")).toHaveLength(1))
  expect(listCollection<Record<string, unknown>>("procurementReceivers")[0]).toMatchObject({ name: "ماجد السالم", role: "site_engineer", title: t.role.site_engineer, phone: "0551002210", organizationId: ORG, active: true })
})

it("will not add the same person twice — it says who, and to edit them instead", async () => {
  await open([existing()])
  fireEvent.change(name(), { target: { value: "أحمد" } })
  fireEvent.change(role(), { target: { value: "warehouse_keeper" } })
  fireEvent.change(phone(), { target: { value: "+966551002210" } })
  await flush()
  expect(screen.getByText(t.err.duplicate.replace("{name}", "أحمد العتيبي"))).toBeTruthy()
  expect(save().disabled).toBe(true)
  expect(listCollection<Record<string, unknown>>("procurementReceivers")).toHaveLength(0)
})

it("says to bring a retired person back rather than add them again", async () => {
  await open([existing({ active: false })])
  fireEvent.change(name(), { target: { value: "أحمد" } })
  fireEvent.change(role(), { target: { value: "warehouse_keeper" } })
  fireEvent.change(phone(), { target: { value: "0551002210" } })
  await flush()
  expect(screen.getByText(t.err.duplicateRetired.replace("{name}", "أحمد العتيبي"))).toBeTruthy()
})
