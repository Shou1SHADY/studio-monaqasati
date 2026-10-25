/** @jest-environment node */
/**
 * Procurement 2.0 finish pass, group C (settings, admin portal, suppliers, sidebar and header, guide, windows): the prototype's
 * words that were missing from the message files, the guide's two station buttons, the roles row for inviting suppliers, and the
 * request to be told at launch that the «قريباً» window sends.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { flowSources, flowStations, MY_REQUESTS_HREF } from "@/lib/procurement/guide"
import { roleRows } from "@/lib/procurement/roles-matrix"
import { PROC_SOON_NOTIFY, soonNotifyId } from "@/lib/procurement/soon-notify"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))

import { POST as soonNotify } from "@/app/api/procurement/soon-notify/route"

const at = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string, unknown>)[k] : undefined), tree)

const WORDS: Array<[string, string, string]> = [
  ["Portal.ProcGuide.btn.open_mine_as", "افتح «طلباتي» كما يراها", "Open “My requests” as he sees it"],
  ["Portal.ProcGuide.btn.on_behalf", "ارفع طلباً نيابةً", "Raise one on behalf"],
  ["Portal.ProcGuide.btn.on_behalf_him", "ارفع طلباً نيابةً عنه", "Raise one on his behalf"],
  ["Portal.ProcMyRequests.line_failed_check", "تعذّر الشراء — راجع المشتريات", "Could not buy — check with Procurement"],
  ["Portal.ProcSettings.policy.offerVisibility.label", "ظهور العروض", "Offer visibility"],
  ["Portal.ProcSettings.policy.offerVisibility.desc", "فور وصولها للمشتريات؛ والمورّد لا يرى أسعار غيره أبداً", "The moment they arrive, to Procurement; a supplier never sees other prices"],
  ["Portal.ProcSettings.policy.tieBandPct.desc", "فرق ≤ {pct}% عن الأقل يُعدّ «الأقل» بلا سبب", "Within {pct}% of the lowest counts as lowest, no reason needed"],
  ["Portal.ProcSettings.policy.ownerStepsBack.desc", "متوقف: المالك يملك أفعال المشتريات كلها", "Off: the owner holds every procurement action"],
  ["Portal.ProcSettings.policy.sendOnApproval.descOn", "مفعّل: يصل المورد المسجّل في بوابته، وغير المشترك برسالة واتساب أو بريد", "On: registered suppliers get it in their portal; others by WhatsApp or email"],
  ["Portal.ProcSettings.accountant.empty", "فارغ — يُطلب عند أول إرسال", "Empty — asked on first send"],
  ["Portal.ProcSettings.sites.line_warehouse_inv", "مستودع رئيسي · من المخزون", "Main warehouse · from Inventory"],
  ["Portal.ProcSettings.sites.line_warehouse", "مستودع", "Warehouse"],
  ["Portal.ProcSettings.sites.line_workshop", "مستودع الورشة · أُضيف من التصنيع", "Workshop store · added from Manufacturing"],
  ["Portal.ProcReceivers.access.label", "الوصول", "Access"],
  ["Portal.ProcReceivers.access.account", "حسابه: «مهامي»", "His account: My tasks"],
  ["Portal.ProcReceivers.access.link", "رابط ورمز", "Link and code"],
  ["Portal.ProcSettings.roles2.row_invite_suppliers", "يدعو مورداً ويضيفه إلى مورّدينا", "Invites and adds suppliers"],
  ["Portal.Layout.hub", "الموزّع", "Hub"],
  ["Portal.Layout.account", "الحساب", "Account"],
  ["Portal.Layout.collapse_menu", "اطوِ القائمة", "Collapse"],
  ["Portal.Layout.owner_holds_procurement", "المالك يملك أفعال المشتريات كلها افتراضياً.", "The owner holds every procurement action by default."],
  ["Portal.Sidebar.proc_sub", "الطلبات الواردة · العروض · أوامر الشراء", "Incoming · RFQs · Purchase orders"],
  ["Portal.Sidebar.admin_leads", "العملاء المحتملون", "Leads"],
  ["Portal.Procurement.award2.via_link", "من رابط الزوار — خارج المنصة", "Via the visitor link — off-platform"],
  ["Portal.ProcSoon.notify", "أبلغني حين يُطلق", "Notify me at launch"],
  ["Portal.ProcSoon.notified", "سنبلغك حين يُطلق الشراء بالأجل.", "We will notify you when pay-later launches."],
  ["Portal.Admin.Contractors.company_name", "المقاول", "Contractor"],
]

describe("the prototype's words, in both languages", () => {
  it.each(WORDS)("%s", (key, arabic, english) => {
    expect(at(ar, key)).toBe(arabic)
    expect(at(en, key)).toBe(english)
  })

  it("the workshop sentence of the package impact is the prototype's in English, and the soon window names the credit limit", () => {
    expect(at(en, "Portal.AdminPackages.impact.sentence.mfg_on")).toBe("The workshop is asked from now on; what was published does not change.")
    expect(at(ar, "Portal.ProcSoon.where")).toContain("لحسابك وحدّك الائتماني")
    expect(at(en, "Portal.ProcSoon.where")).toContain("your account and credit limit")
  })

  it("the retired seal wording stays out of the offer-visibility row", () => {
    for (const lang of [ar, en]) expect(String(at(lang, "Portal.ProcSettings.policy.offerVisibility.desc"))).not.toMatch(/مختوم|sealed/i)
  })
})

describe("the guide's first station", () => {
  const team = { pm: false, fin: false, mfg: false }
  const pm = { pm: true, fin: false, mfg: false }

  it("offers both buttons — open «طلباتي» as he sees it, and raise one on his behalf — without Projects", () => {
    const [first] = flowStations(team, team)
    expect(first.links.map((l) => l.labelKey)).toEqual(["btn.open_mine_as", "btn.on_behalf_him"])
    expect(first.links.every((l) => l.href === MY_REQUESTS_HREF)).toBe(true)
  })

  it("offers none with Projects, or when previewing from a company that has it", () => {
    expect(flowStations(pm, pm)[0].links).toEqual([])
    expect(flowStations(team, pm)[0].links).toEqual([])
  })

  it("the source cards keep the short labels", () => {
    expect(flowSources(team, team).map((s) => s.link?.labelKey)).toEqual(["btn.open_mine", "btn.on_behalf", "btn.incoming"])
  })
})

describe("the roles row for inviting suppliers", () => {
  const ctx = { financeOn: true, pmOn: false, mfgOn: false, ownerStepsBack: false }

  it("sits after following dates, and belongs to the manager and the buyer — never the expediter", () => {
    const ids = roleRows(ctx).map((r) => r.id)
    expect(ids.indexOf("invite_suppliers")).toBe(ids.indexOf("expedite") + 1)
    expect(roleRows(ctx).find((r) => r.id === "invite_suppliers")?.cells).toEqual({ owner: true, manager: true, buyer: true, expediter: false, requester: false })
  })
})

describe("the request to be told at launch", () => {
  beforeEach(() => {
    mockDb.docs.clear()
    mockDb.writes.length = 0
    mockDb.seed("users/u1", { organizationId: "org1" })
    mockDb.seed("users/solo", {})
  })
  const post = (token: string | null, body: unknown) =>
    soonNotify(
      new NextRequest("http://localhost/api/procurement/soon-notify", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    )

  it("refuses a request nobody signed", async () => {
    expect((await post(null, { topic: "bnpl" })).status).toBe(401)
    expect((await post("bad", { topic: "bnpl" })).status).toBe(401)
    expect(mockDb.writes).toHaveLength(0)
  })

  it("refuses a topic it does not know", async () => {
    const res = await post("u1", { topic: "market" })
    expect(res.status).toBe(400)
    expect(mockDb.writes).toHaveLength(0)
  })

  it("keeps one entry per member and topic, named by his company", async () => {
    expect((await post("u1", { topic: "bnpl" })).status).toBe(200)
    expect((await post("u1", { topic: "bnpl" })).status).toBe(200)
    expect(mockDb.list(PROC_SOON_NOTIFY)).toHaveLength(1)
    expect(mockDb.get(`${PROC_SOON_NOTIFY}/${soonNotifyId("u1", "bnpl")}`)).toMatchObject({ userId: "u1", organizationId: "org1", topic: "bnpl" })
  })

  it("a solo account is its own company", async () => {
    await post("solo", { topic: "bnpl" })
    expect(mockDb.get(`${PROC_SOON_NOTIFY}/${soonNotifyId("solo", "bnpl")}`)).toMatchObject({ organizationId: "solo" })
  })
})
