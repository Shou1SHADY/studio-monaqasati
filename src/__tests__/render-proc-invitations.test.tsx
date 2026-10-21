jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const user = { uid: "acme", email: "acme@test.sa", getIdToken: async () => "id-token" }
  return { ...jest.requireActual("@/test-utils/render-world").firebaseMock, useUser: () => ({ user, isUserLoading: false, userError: null }) }
})
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/hooks/useMaterialTree", () => ({ useMaterialTree: () => ({ index: null }) }))
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "id-token" } }) }))

/**
 * PUR-05 — the screens of the invitation: the dialog that sends it and the list that follows it.
 * The dialog: one contact field, a channel that fits it, a ready text with the company's name,
 * the duplicates said before sending. The list: each invitation with its state and only the
 * acts that state allows («أعد الإرسال», «ألغِ», «افتح ملفه»).
 */

import React from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { installDomShims, missingKeys, setSignedIn } from "@/test-utils/render-world"
import { resetFakeDb } from "@/test-utils/fake-firestore"
import { InviteSupplierDialog } from "@/components/procurement/InviteSupplierDialog"
import { SupplierInvitations, type InvitationDoc } from "@/components/procurement/SupplierInvitations"
import { LINK_TOKEN } from "@/lib/procurement/invitations"
import ar from "../../messages/ar.json"

installDomShims()
jest.setTimeout(30_000)

const S = (ar as unknown as { Portal: { ProcSuppliers: { inv2: Record<string, string>; inv: { err: Record<string, string> } } } }).Portal.ProcSuppliers
const w = S.inv2
const NOW = new Date("2026-10-21T09:00:00Z")
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

type FetchCall = { url: string; init: RequestInit & { body?: string } }
let calls: FetchCall[] = []
let sendReply: unknown = { success: true, data: { joinUrl: "https://mdmaktech.sa/register?invite=abc", delivered: true } }

beforeEach(() => {
  resetFakeDb()
  setSignedIn("acme")
  missingKeys.clear()
  calls = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: FetchCall["init"]) => {
    calls.push({ url: String(url), init })
    return { ok: true, status: 200, json: async () => sendReply }
  })
  window.open = jest.fn(() => ({ location: { href: "" }, close: jest.fn(), opener: {} })) as unknown as typeof window.open
  window.confirm = jest.fn(() => true)
})

describe("the invitation dialog", () => {
  const open = (props: Partial<React.ComponentProps<typeof InviteSupplierDialog>> = {}) =>
    render(<InviteSupplierDialog open onOpenChange={jest.fn()} orgName="شركة البنيان الحديثة" {...props} />)
  const field = (label: string) => screen.getByLabelText(new RegExp(label)) as HTMLInputElement

  it("opens with a ready text in the company's name, and says the invitation carries no request or price", async () => {
    open()
    await flush()
    const text = (screen.getByLabelText(w.message) as HTMLTextAreaElement).value
    expect(text).toContain("شركة البنيان الحديثة")
    expect(text).toContain(w.link_word)
    expect(screen.getByText(w.not_rfq)).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("greets the contact by name in the text until the sender edits it", async () => {
    open()
    await flush()
    fireEvent.change(field(w.contact_name), { target: { value: "أبو خالد" } })
    await flush()
    expect((screen.getByLabelText(w.message) as HTMLTextAreaElement).value).toContain("السلام عليكم أبو خالد")
  })

  it("refuses to send without a company or a usable contact", async () => {
    open()
    await flush()
    fireEvent.click(screen.getByRole("button", { name: w.send_wa }))
    await flush()
    expect(screen.getByText(S.inv.err.name_missing)).toBeTruthy()
    expect(calls).toHaveLength(0)
    fireEvent.change(field(w.company), { target: { value: "مؤسسة الفهد" } })
    fireEvent.change(field(w.contact), { target: { value: "12345" } })
    fireEvent.click(screen.getByRole("button", { name: w.send_wa }))
    await flush()
    expect(screen.getByText(w.err_contact)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it("sends a WhatsApp invitation: the ready text with the link token, then opens the chat", async () => {
    open()
    await flush()
    fireEvent.change(field(w.company), { target: { value: "مؤسسة الفهد" } })
    fireEvent.change(field(w.contact), { target: { value: "0550000000" } })
    fireEvent.click(screen.getByRole("button", { name: w.send_wa }))
    await waitFor(() => expect(calls).toHaveLength(1))
    const body = JSON.parse(calls[0].init.body as string)
    expect(calls[0].url).toBe("/api/invitations/send")
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer id-token" })
    expect(body).toMatchObject({ type: "supplier_invite", companyName: "مؤسسة الفهد", phone: "0550000000", channel: "wa", fullText: true, specialtyIds: [] })
    expect(body.email).toBeUndefined()
    expect(body.message).toContain(LINK_TOKEN)
    expect(body.message).not.toContain(w.link_word)
    expect(window.open).toHaveBeenCalled()
  })

  it("a mobile cannot go by e-mail, an address cannot go by WhatsApp or a text message", async () => {
    open()
    await flush()
    fireEvent.change(field(w.contact), { target: { value: "0550000000" } })
    await flush()
    expect((screen.getByRole("radio", { name: w.ch_email }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("radio", { name: w.ch_sms }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(field(w.contact), { target: { value: "fahd@example.sa" } })
    await flush()
    expect((screen.getByRole("radio", { name: w.ch_wa }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("radio", { name: w.ch_email }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("says when the number was invited before, and offers «أعد الإرسال» in place of a second invitation", async () => {
    open({ invitations: [{ id: "i1", status: "pending", phone: "0550000000", createdAt: "2026-10-12T09:00:00Z" }] })
    await flush()
    fireEvent.change(field(w.contact), { target: { value: "+966 55 000 0000" } })
    await flush()
    expect(screen.getByText(/دُعي في/)).toBeTruthy()
    expect(screen.getByRole("button", { name: w.resend })).toBeTruthy()
  })

  it("says when the supplier is on the platform already, and adds him to «مورّدينا» instead", async () => {
    const onAddExisting = jest.fn()
    const onOpenChange = jest.fn()
    open({ platform: [{ orgId: "sup9", name: "مصنع الشرق", phone: "0561112233" }], onAddExisting, onOpenChange })
    await flush()
    fireEvent.change(field(w.contact), { target: { value: "0561112233" } })
    await flush()
    expect(screen.getByText(/«مصنع الشرق» موجود في المنصة/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: w.add_existing }))
    expect(onAddExisting).toHaveBeenCalledWith("sup9")
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(calls).toHaveLength(0)
  })

  it("says so, and sends nothing more, when the platform could not send", async () => {
    sendReply = { success: false }
    open()
    await flush()
    fireEvent.change(field(w.company), { target: { value: "مؤسسة الفهد" } })
    fireEvent.change(field(w.contact), { target: { value: "0550000000" } })
    fireEvent.click(screen.getByRole("button", { name: w.send_wa }))
    await waitFor(() => expect(calls).toHaveLength(1))
    await flush()
    expect(window.open).toHaveBeenCalledTimes(1)
    sendReply = { success: true, data: { joinUrl: "https://mdmaktech.sa/register?invite=abc", delivered: true } }
  })
})

describe("the invitations list", () => {
  const inv = (over: Partial<InvitationDoc> & { id: string }): InvitationDoc => ({
    type: "supplier_invite",
    status: "pending",
    companyName: "مؤسسة الفهد",
    contactName: "أبو خالد",
    phone: "0550000000",
    createdAt: "2026-10-19T09:00:00.000Z",
    sentChannel: "wa",
    ...over,
  })
  const list = (invitations: InvitationDoc[], props: Partial<React.ComponentProps<typeof SupplierInvitations>> = {}) =>
    render(<SupplierInvitations invitations={invitations} canManage now={NOW} onResend={jest.fn()} {...props} />)
  const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement

  it("says what an empty list is for", () => {
    list([])
    expect(screen.getByText(w.none)).toBeTruthy()
  })

  it("shows each invitation with its state: sent · opened · joined", () => {
    list([
      inv({ id: "a", companyName: "مرسلة" }),
      inv({ id: "b", companyName: "مفتوحة", openedAt: "2026-10-20T09:00:00.000Z" }),
      inv({ id: "c", companyName: "منضمة", status: "accepted", acceptedSupplierOrgId: "sup1" }),
    ])
    expect(within(row("مرسلة")).getByText(w.st_sent)).toBeTruthy()
    expect(within(row("مفتوحة")).getByText(w.st_opened)).toBeTruthy()
    expect(within(row("منضمة")).getByText(w.st_joined_ours)).toBeTruthy()
  })

  it("an invitation older than 30 days reads «انتهت» and can be sent again, not cancelled", () => {
    list([inv({ id: "d", companyName: "منتهية" })], { now: new Date("2026-12-30T00:00:00Z") })
    expect(within(row("منتهية")).getByText(w.st_expired)).toBeTruthy()
    expect(within(row("منتهية")).getByRole("button", { name: w.resend })).toBeTruthy()
    expect(within(row("منتهية")).queryByRole("button", { name: w.cancel })).toBeNull()
  })

  it("each state offers only its own acts", () => {
    list([
      inv({ id: "a", companyName: "مرسلة" }),
      inv({ id: "b", companyName: "مفتوحة", openedAt: "2026-10-20T09:00:00.000Z" }),
      inv({ id: "c", companyName: "منضمة", status: "accepted", acceptedSupplierOrgId: "sup1" }),
      inv({ id: "e", companyName: "ملغاة", status: "cancelled" }),
    ])
    expect(within(row("مرسلة")).getByText(w.st_sent)).toBeTruthy()
    expect(within(row("مرسلة")).getByRole("button", { name: w.resend })).toBeTruthy()
    expect(within(row("مرسلة")).getByRole("button", { name: w.cancel })).toBeTruthy()
    expect(within(row("مفتوحة")).getByText(w.st_opened)).toBeTruthy()
    expect(within(row("منضمة")).getByText(w.st_joined_ours)).toBeTruthy()
    expect(within(row("منضمة")).queryByRole("button", { name: w.cancel })).toBeNull()
    expect(within(row("ملغاة")).getByText(w.st_cancelled)).toBeTruthy()
    expect(within(row("ملغاة")).getByRole("button", { name: w.resend })).toBeTruthy()
    expect(within(row("ملغاة")).queryByRole("button", { name: w.cancel })).toBeNull()
  })

  it("a reader without the right sees the states and none of the acts", () => {
    list([inv({ id: "a", companyName: "مرسلة" })], { canManage: false })
    expect(within(row("مرسلة")).getByText(w.st_sent)).toBeTruthy()
    expect(screen.queryByRole("button", { name: w.resend })).toBeNull()
    expect(screen.queryByRole("button", { name: w.cancel })).toBeNull()
  })

  it("«أعد الإرسال» hands the contact back to the dialog", () => {
    const onResend = jest.fn()
    list([inv({ id: "a", companyName: "مرسلة", specialtyIds: ["cement"] })], { onResend })
    fireEvent.click(screen.getByRole("button", { name: w.resend }))
    expect(onResend).toHaveBeenCalledWith({ companyName: "مرسلة", contactName: "أبو خالد", contact: "0550000000", specialtyIds: ["cement"] })
  })

  it("«ألغِ» asks first, then cancels exactly that invitation on the server", async () => {
    list([inv({ id: "a", companyName: "مرسلة" })])
    fireEvent.click(screen.getByRole("button", { name: w.cancel }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(window.confirm).toHaveBeenCalled()
    expect(calls[0].url).toBe("/api/invitations/cancel")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ invitationId: "a" })
  })

  it("changes nothing when the sender declines the question", async () => {
    window.confirm = jest.fn(() => false)
    list([inv({ id: "a", companyName: "مرسلة" })])
    fireEvent.click(screen.getByRole("button", { name: w.cancel }))
    await flush()
    expect(calls).toHaveLength(0)
  })

  it("a supplier who joined opens his file from here", () => {
    const onOpenSupplier = jest.fn()
    list([inv({ id: "c", companyName: "منضمة", status: "accepted", acceptedSupplierOrgId: "sup1" })], { onOpenSupplier })
    fireEvent.click(screen.getByRole("button", { name: w.open_file }))
    expect(onOpenSupplier).toHaveBeenCalledWith("sup1")
  })
})
