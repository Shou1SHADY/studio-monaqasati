/** @jest-environment node */
/**
 * Procurement 2.0 — finish pass, the demand side (INC-06 «قادمة» and «نبّهني حين يصل», the paste dialog's unit, the offer's
 * «خفّض 3% بعد طلبك», «نُشر الآن»): the pure rules and the server half over an in-memory Admin Firestore.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "b", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "b",
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] } }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => false,
  sendSms: async () => ({ sent: true }),
  sendWhatsApp: async () => ({ sent: true }),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { GET as watchList, POST as watchPost } from "@/app/api/procurement/upcoming-watch/route"
import { syncIncoming } from "@/lib/procurement/incoming-server"
import { notifyArrived, notifyStockReached, setWatch, watchedKeys, watchDocId } from "@/lib/procurement/upcoming-watch-server"
import { UPCOMING_STOCK_MARGIN, isWatchKey, sortUpcoming, upcomingFromProjects, upcomingFromStock } from "@/lib/procurement/upcoming"
import { isJustPublished, JUST_PUBLISHED_MS } from "@/lib/procurement/rfq-list"
import { offerTags } from "@/lib/procurement/offer-labels"
import { linesFromPaste } from "@/lib/procurement/rfq-editor"
import { indexTree } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"
import type { Firestore } from "firebase-admin/firestore"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"

const ORG = "org1"
const db = () => mockDb as unknown as Firestore
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`)

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", name: "سعد" })
  mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين", location: "الرياض - حي الياسمين" })
})

const pending = (id: string, over: Record<string, unknown> = {}): ProjectRequestDoc =>
  ({
    id,
    pm: true,
    status: "pending",
    needBy: "2026-11-11",
    requestedByUserName: "م. فهد",
    createdAt: "2026-10-24T08:00:00.000Z",
    lines: [{ itemId: "i1", code: "04-01", key: "k1", name: "اسياخ حديد 16", unit: "طن", qty: 12 }],
    ...over,
  }) as unknown as ProjectRequestDoc

describe("«قادمة» — what is read before it arrives (INC-06)", () => {
  it("a project's request awaiting technical approval is upcoming; an approved, a legacy and a withdrawn one are not", () => {
    const items = upcomingFromProjects([
      {
        project: { id: "P1", name: "مجمع الياسمين" },
        requests: [pending("05"), pending("06", { status: "approved" }), pending("07", { pm: false }), pending("08", { status: "rejected", withdrawn: true }), pending("09", { lines: [] })],
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: "pm:P1:05", kind: "approval", ref: "MR 05", place: "مجمع الياسمين", by: "م. فهد", since: "2026-10-24", needBy: "2026-11-11", stock: null })
    expect(items[0].lines).toEqual([{ name: "اسياخ حديد 16", unit: "طن", qty: 12 }])
  })

  it("a stock item is upcoming only just above its minimum — at or below it is already a need, further above it is not near", () => {
    const row = (id: string, quantity: number, min: number | null) => ({ id, warehouseId: "w1", warehouseName: "المستودع المركزي", name: `صنف ${id}`, unit: "كيس", quantity, minStockLevel: min })
    const items = upcomingFromStock([row("a", 110, 100), row("b", 100, 100), row("c", 90, 100), row("d", 100 * (1 + UPCOMING_STOCK_MARGIN), 100), row("e", 126, 100), row("f", 50, null), row("g", 5, 0)])
    expect(items.map((i) => i.key)).toEqual(["stock:w1:a", "stock:w1:d"])
    expect(items[0]).toMatchObject({ kind: "stock", ref: null, place: "المستودع المركزي", stock: { onHand: 110, min: 100 } })
    expect(items[0].lines[0].qty).toBe(90)
  })

  it("requests awaiting approval come first, the nearest need date first; the stock items follow, the closest to their minimum first", () => {
    const [a] = upcomingFromProjects([{ project: { id: "P1", name: "ع" }, requests: [pending("05", { needBy: "2026-12-01" })] }])
    const [b] = upcomingFromProjects([{ project: { id: "P1", name: "ع" }, requests: [pending("06", { needBy: "2026-11-01" })] }])
    const [far, near] = upcomingFromStock([
      { id: "x", warehouseId: "w", warehouseName: "م", name: "x", unit: "u", quantity: 120, minStockLevel: 100 },
      { id: "y", warehouseId: "w", warehouseName: "م", name: "y", unit: "u", quantity: 105, minStockLevel: 100 },
    ])
    expect(sortUpcoming([far, a, near, b]).map((i) => i.key)).toEqual(["pm:P1:06", "pm:P1:05", "stock:w:y", "stock:w:x"])
  })

  it("a watch key is a request's or a stock item's — nothing else is accepted", () => {
    expect(isWatchKey("pm:P1:05")).toBe(true)
    expect(isWatchKey("stock:w1:item9")).toBe(true)
    for (const bad of ["", "pm:P1", "mfg:W1:PRQ1", "stock:w1", "pm:P1:05:x", "pm: P1:05", "team:abc"]) expect(isWatchKey(bad)).toBe(false)
  })
})

describe("«نبّهني حين يصل» — a watch on what is not in Incoming yet", () => {
  it("is put on and taken off by the member, and read back for him only", async () => {
    expect(await setWatch(db(), ORG, "buyer", "pm:P1:05", true)).toBe("ok")
    expect(await setWatch(db(), ORG, "other", "pm:P1:05", true)).toBe("ok")
    expect(await setWatch(db(), ORG, "buyer", "stock:w1:i1", true)).toBe("ok")
    expect((await watchedKeys(db(), ORG, "buyer")).sort()).toEqual(["pm:P1:05", "stock:w1:i1"])
    expect(await watchedKeys(db(), ORG, "other")).toEqual(["pm:P1:05"])
    expect(await setWatch(db(), ORG, "buyer", "pm:P1:05", false)).toBe("ok")
    expect(await watchedKeys(db(), ORG, "buyer")).toEqual(["stock:w1:i1"])
    expect(mockDb.get(`procUpcomingWatch/${watchDocId(ORG, "pm:P1:05")}`)).toMatchObject({ organizationId: ORG, key: "pm:P1:05", userIds: ["other"] })
  })

  it("refuses a key that is not a request's or a stock item's", async () => {
    expect(await setWatch(db(), ORG, "buyer", "mfg:W1:PRQ1", true)).toBe("bad_key")
    expect(mockDb.list("procUpcomingWatch")).toHaveLength(0)
  })

  it("tells every watcher once when the request they watched is approved and ingested — and the watch is spent", async () => {
    await setWatch(db(), ORG, "buyer", "pm:P1:03", true)
    await setWatch(db(), ORG, ORG, "pm:P1:03", true)
    mockDb.seed("projects/P1/purchaseRequests/03", {
      pm: true,
      seq: 3,
      title: "بلوك",
      status: "approved",
      needBy: "2026-11-11",
      requestedByUserId: "eng1",
      requestedByUserName: "م. فهد",
      approvedByName: "م. خالد",
      approvedOn: "2026-10-24",
      createdAt: "2026-10-23T08:00:00.000Z",
      lines: [{ itemId: "i1", code: "04-01-01", key: "k1", name: "بلك مفرغ", unit: "حبة", qty: 2000, inv: { k: "none", q: 0, kept: 2000, on: "2026-10-24" } }],
      items: [{ name: "بلك مفرغ", unit: "حبة", quantity: 2000, itemId: "i1" }],
    })
    const r = await syncIncoming(db(), ORG, { now: new Date("2026-10-25T08:00:00.000Z") })
    expect(r.created).toBe(1)
    for (const uid of ["buyer", ORG]) {
      expect(notices(uid)).toHaveLength(1)
      expect(notices(uid)[0]).toMatchObject({ type: "upcoming_arrived", i18n: { title: "pn_upcoming_arrived_title", message: "pn_upcoming_arrived", params: { ref: "MR 03" } }, link: "/contractor/rfqs/requests", read: false })
    }
    expect(await watchedKeys(db(), ORG, "buyer")).toEqual([])
    await syncIncoming(db(), ORG, { now: new Date("2026-10-25T09:00:00.000Z") })
    expect(notices("buyer")).toHaveLength(1)
  })

  it("a request that is still pending tells nobody", async () => {
    await setWatch(db(), ORG, "buyer", "pm:P1:04", true)
    mockDb.seed("projects/P1/purchaseRequests/04", { pm: true, seq: 4, status: "pending", requestedByUserId: "eng1", lines: [{ itemId: "i1", code: "x", key: "k", name: "ح", unit: "طن", qty: 1 }] })
    await syncIncoming(db(), ORG, { now: new Date("2026-10-25T08:00:00.000Z") })
    expect(notices("buyer")).toHaveLength(0)
    expect(await watchedKeys(db(), ORG, "buyer")).toEqual(["pm:P1:04"])
  })

  it("a stock item that reached its minimum tells its watchers; one still above it tells nobody", async () => {
    mockDb.seed("warehouses/w1", { organizationId: ORG, name: "المستودع المركزي" })
    mockDb.seed("warehouses/w1/inventoryItems/i1", { name: "اسمنت", quantity: 100, minStockLevel: 100 })
    mockDb.seed("warehouses/w1/inventoryItems/i2", { name: "رمل", quantity: 130, minStockLevel: 100 })
    await setWatch(db(), ORG, "buyer", "stock:w1:i1", true)
    await setWatch(db(), ORG, "buyer", "stock:w1:i2", true)
    expect(await notifyStockReached(db(), ORG, "2026-10-25T08:00:00.000Z")).toBe(1)
    expect(notices("buyer")).toHaveLength(1)
    expect(notices("buyer")[0]).toMatchObject({ i18n: { params: { ref: "اسمنت" } } })
    expect(await watchedKeys(db(), ORG, "buyer")).toEqual(["stock:w1:i2"])
  })

  it("another company's warehouse is never read for a watcher", async () => {
    mockDb.seed("warehouses/wx", { organizationId: "someone-else", name: "ع" })
    mockDb.seed("warehouses/wx/inventoryItems/i1", { name: "اسمنت", quantity: 1, minStockLevel: 100 })
    await setWatch(db(), ORG, "buyer", "stock:wx:i1", true)
    expect(await notifyStockReached(db(), ORG)).toBe(0)
    expect(notices("buyer")).toHaveLength(0)
  })

  it("notifyArrived skips a key nobody watches", async () => {
    expect(await notifyArrived(db(), ORG, [{ key: "pm:P1:99", ref: "MR 99" }])).toBe(0)
  })
})

describe("/api/procurement/upcoming-watch", () => {
  const post = (body: unknown, token = "tok:buyer") => watchPost(new NextRequest("http://x/api/procurement/upcoming-watch", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  const get = (token = "tok:buyer") => watchList(new NextRequest("http://x/api/procurement/upcoming-watch", { headers: { authorization: `Bearer ${token}` } }))

  it("needs a signed-in member of a company", async () => {
    expect((await get("")).status).toBe(401)
    expect((await post({ key: "pm:P1:05", on: true }, "tok:ghost")).status).toBe(401)
  })

  it("puts a watch on, lists it, takes it off; a bad key or body is a 400", async () => {
    expect((await post({ key: "pm:P1:05", on: true })).status).toBe(200)
    const listed = (await (await get()).json()) as { success: boolean; data: { keys: string[] } }
    expect(listed).toMatchObject({ success: true, data: { keys: ["pm:P1:05"] } })
    expect((await post({ key: "pm:P1:05", on: false })).status).toBe(200)
    expect(((await (await get()).json()) as { data: { keys: string[] } }).data.keys).toEqual([])
    expect((await post({ key: "mfg:W:1", on: true })).status).toBe(400)
    expect((await post({ key: "pm:P1:05" })).status).toBe(400)
  })
})

describe("the offer's own words and the list's «نُشر الآن»", () => {
  it("«خفّض 3% بعد طلبك»: the tag carries what the answering version took off the one before it", () => {
    const base = { bafo: { at: "2026-10-20", byId: "u", byName: "n", replyBy: "2026-10-23", note: null, round: 1 as const, answered: { at: "2026-10-22", n: 2, kind: "lowered" as const } }, createdAt: "2026-10-18T08:00:00Z" }
    const tags = offerTags({ offer: { ...base, versions: [{ n: 1, at: "2026-10-18", total: 10000 }, { n: 2, at: "2026-10-22", total: 9700, bafoReply: "lowered" }] }, today: "2026-10-25" })
    expect(tags.find((t) => t.code === "bafo_lowered")).toEqual({ code: "bafo_lowered", value: 3 })
    const unknown = offerTags({ offer: { ...base, versions: [{ n: 2, at: "2026-10-22", bafoReply: "lowered" }] }, today: "2026-10-25" })
    expect(unknown.find((t) => t.code === "bafo_lowered")?.value).toBeUndefined()
  })

  it("an RFQ is «نُشر الآن» for an hour after it was published, and a draft never is", () => {
    const at = Date.parse("2026-10-25T08:00:00Z")
    expect(isJustPublished({ state: "open", publishedMs: at }, at + 59 * 60_000)).toBe(true)
    expect(isJustPublished({ state: "open", publishedMs: at }, at + JUST_PUBLISHED_MS)).toBe(false)
    expect(isJustPublished({ state: "draft", publishedMs: at }, at + 1000)).toBe(false)
    expect(isJustPublished({ state: "open", publishedMs: 0 }, at)).toBe(false)
  })
})

describe("«الصق من إكسل» — the unit comes from the material; a different pasted unit is flagged (CAT-07)", () => {
  const tree = JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile
  const index = indexTree(tree.roots)

  it("a unit that names one of the material's is kept; one that does not is flagged and the row takes the material's", () => {
    const [ok, differs, free] = linesFromPaste(
      [
        { name: "اسياخ حديد التسليح 16", quantity: "8", unit: "طن" },
        { name: "اسياخ حديد التسليح 12", quantity: "5", unit: "حبة" },
        { name: "شيء غريب جداً", quantity: "3", unit: "كرتون" },
      ],
      index,
      { unitFromMaterial: true },
    )
    expect(ok).toMatchObject({ unit: "طن", pastedUnit: null, unitFromSource: false })
    expect(differs.material).not.toBeNull()
    expect(differs).toMatchObject({ unit: "طن", pastedUnit: "حبة", unitFromSource: false })
    expect(free.material).toBeNull()
    expect(free).toMatchObject({ unit: "كرتون", unitFromSource: true })
  })

  it("without the option the pasted unit stays as it arrived (the BOQ import's way)", () => {
    const [row] = linesFromPaste([{ name: "اسياخ حديد التسليح 12", quantity: "5", unit: "حبة" }], index)
    expect(row).toMatchObject({ unit: "حبة", unitFromSource: true })
    expect(row.pastedUnit).toBeUndefined()
  })
})
