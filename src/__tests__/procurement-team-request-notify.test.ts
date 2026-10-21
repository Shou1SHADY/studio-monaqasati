/** @jest-environment node */
/**
 * PUR-10: the requester of a «طلب مواد» hears when it moves — in an RFQ, in an order, on the way,
 * received — once per move, in his notifications and in «مهامي»; and any member can raise one,
 * whatever his Procurement permissions.
 */
import { readFileSync } from "fs"
import { join } from "path"
import type { Firestore } from "firebase-admin/firestore"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { TEAM_NOTICE_COPY_AR, notifyTeamRequestMoves, orgWorld, syncTeamRequests } from "@/lib/procurement/team-request-notify-server"
import { TEAM_REQUESTS, teamSource, type TeamRequestDoc } from "@/lib/procurement/team-requests"
import { queueTasks, queueTitle } from "@/lib/work-queue-tasks"
import type { WorkQueueItem } from "@/hooks/useWorkQueue"
import { CONTRACTOR_COMPONENTS } from "@/lib/portal-components"
import { roleRows } from "@/lib/procurement/roles-matrix"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

const ORG = "org1"
const NOW = "2026-10-21T08:00:00.000Z"
const asDb = (db: FakeAdminDb) => db as unknown as Firestore

const request = (over: Partial<TeamRequestDoc> = {}): Omit<TeamRequestDoc, "id"> => ({
  organizationId: ORG,
  number: "MAT-2026/014",
  lines: [{ name: "اسمنت", unit: "كيس", quantity: 200 }],
  needBy: "2026-11-10",
  place: { label: "المستودع المركزي", city: "Riyadh", district: "" },
  requestedById: "u7",
  requestedByName: "فهد",
  createdAt: "2026-10-20T08:00:00Z",
  status: "open",
  ...over,
})
const rfq = { organizationId: ORG, status: "New", rfqNumber: "RFQ-2026/031", needSources: [teamSource("t1")], createdAt: "2026-10-21T05:00:00Z" }
const line = (accepted: number) => ({ id: "l1", name: "اسمنت", unit: "كيس", quantity: 200, unitPrice: 4, accepted, rejected: 0, held: 0, cancelled: 0 })
const po = (accepted = 0) => ({ organizationId: ORG, docNumber: "PO-2026/021", status: "accepted", rfqId: "r1", lines: [line(accepted)] })

const notices = (db: FakeAdminDb) => db.list("users/u7/notifications")
const stored = (db: FakeAdminDb) => db.get(`${TEAM_REQUESTS}/t1`) as unknown as TeamRequestDoc & { notifiedState?: string }

describe("telling the requester his request moved", () => {
  it("says nothing while it only sits with Procurement", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request())
    expect(await syncTeamRequests(asDb(db), ORG, NOW)).toEqual({ checked: 1, told: 0 })
    expect(notices(db)).toHaveLength(0)
  })

  it("tells him once when an RFQ is published, and stays quiet on the next look", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request()).seed("rfqs/r1", rfq)
    expect((await syncTeamRequests(asDb(db), ORG, NOW)).told).toBe(1)
    expect((await syncTeamRequests(asDb(db), ORG, NOW)).told).toBe(0)
    expect(notices(db)).toHaveLength(1)
    expect(notices(db)[0]).toMatchObject({
      userId: "u7",
      type: "team_request_moved",
      link: "/contractor/rfqs/my-requests",
      i18n: { title: "pn_team_request_rfq_title", message: "pn_team_request_rfq", params: { number: "MAT-2026/014", ref: "RFQ-2026/031" } },
    })
    expect(stored(db)).toMatchObject({ notifiedState: "rfq", stateAt: NOW })
  })

  it("follows it into an order, on the way, and received — one notice each", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request()).seed("rfqs/r1", rfq)
    await syncTeamRequests(asDb(db), ORG, NOW)
    db.seed("purchaseOrders/po1", po(0))
    await syncTeamRequests(asDb(db), ORG, NOW)
    db.seed("purchaseOrders/po1", po(80))
    await syncTeamRequests(asDb(db), ORG, NOW)
    db.seed("purchaseOrders/po1", po(200))
    await syncTeamRequests(asDb(db), ORG, NOW)
    expect(notices(db).map((n) => (n.i18n as { message: string }).message).sort()).toEqual(["pn_team_request_on_way", "pn_team_request_order", "pn_team_request_received", "pn_team_request_rfq"])
    expect(stored(db).notifiedState).toBe("received")
  })

  it("a move back (the RFQ was cancelled) is recorded silently, and the next publication tells him again", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request()).seed("rfqs/r1", rfq)
    await syncTeamRequests(asDb(db), ORG, NOW)
    db.seed("rfqs/r1", { ...rfq, status: "Cancelled" })
    expect((await syncTeamRequests(asDb(db), ORG, NOW)).told).toBe(0)
    expect(stored(db).notifiedState).toBe("sent")
    db.seed("rfqs/r2", { ...rfq, createdAt: "2026-10-22T05:00:00Z", rfqNumber: "RFQ-2026/040" })
    expect((await syncTeamRequests(asDb(db), ORG, NOW)).told).toBe(1)
    expect(notices(db)).toHaveLength(2)
  })

  it("leaves a withdrawn or declined request, and another company's, alone", async () => {
    const db = new FakeAdminDb()
      .seed(`${TEAM_REQUESTS}/t1`, request({ status: "withdrawn" }))
      .seed(`${TEAM_REQUESTS}/t2`, request({ status: "declined" }))
      .seed(`${TEAM_REQUESTS}/t3`, request({ organizationId: "org2" }))
      .seed("rfqs/r1", rfq)
    expect((await syncTeamRequests(asDb(db), ORG, NOW)).checked).toBe(0)
    expect(notices(db)).toHaveLength(0)
  })

  it("the daily pass without a company covers every company", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request()).seed("rfqs/r1", rfq).seed(`${TEAM_REQUESTS}/t9`, request({ organizationId: "org2", requestedById: "u9" }))
    expect((await syncTeamRequests(asDb(db), undefined, NOW)).checked).toBe(2)
  })

  it("is usable on the requests the caller already loaded", async () => {
    const db = new FakeAdminDb().seed(`${TEAM_REQUESTS}/t1`, request()).seed("rfqs/r1", rfq)
    const world = await orgWorld(asDb(db), ORG)
    expect(await notifyTeamRequestMoves(asDb(db), [{ id: "t1", ...request() }], world, NOW)).toBe(1)
  })
})

describe("the words of the notices", () => {
  const shared = (ar as unknown as { Portal: { Shared: Record<string, string> } }).Portal.Shared
  const sharedEn = (en as unknown as { Portal: { Shared: Record<string, string> } }).Portal.Shared

  it.each(Object.keys(TEAM_NOTICE_COPY_AR) as Array<keyof typeof TEAM_NOTICE_COPY_AR>)("%s: the text rendered by the sender is the message file's, in both languages", (state) => {
    expect(shared[`pn_team_request_${state}_title`]).toBe(TEAM_NOTICE_COPY_AR[state].title)
    expect(shared[`pn_team_request_${state}`]).toBe(TEAM_NOTICE_COPY_AR[state].message)
    expect(sharedEn[`pn_team_request_${state}_title`]).toBeTruthy()
    expect(sharedEn[`pn_team_request_${state}`]).toBeTruthy()
  })
})

describe("his tasks (مهامي)", () => {
  const item = (state: string): WorkQueueItem => ({ id: "team_request_mine_t1", type: "team_request_mine", tier: 6, sortMs: 0, since: Date.parse("2026-10-20T08:00:00Z"), actionUrl: "/contractor/rfqs/my-requests", data: { number: "MAT-2026/014", state } })
  const ctx = (can: () => boolean) => ({ can, modules: { on: () => true, linkable: () => true }, components: CONTRACTOR_COMPONENTS, today: "2026-10-21" })

  it("names the request and where it stands", () => {
    expect(queueTitle(item("order"))).toEqual({ key: "queue_item_team_request_mine", params: { number: "MAT-2026/014", state: { key: "queue_team_state_order" } } })
    const contractor = (ar as unknown as { Portal: { Contractor: Record<string, string> } }).Portal.Contractor
    for (const s of ["sent", "rfq", "order", "on_way"]) expect(contractor[`queue_team_state_${s}`]).toBeTruthy()
  })

  it("is a task for a member who holds no permission at all", () => {
    const tasks = queueTasks([item("rfq")], ctx(() => false))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ itemType: "team_request_mine", href: "/contractor/rfqs/my-requests", tile: "procurement" })
  })
})

describe("who can raise one", () => {
  it("the owner, the manager, the buyer and the requester raise a material request without Project Management — the expediter does not (PRD §4)", () => {
    const row = roleRows({ financeOn: true, pmOn: false, ownerStepsBack: false }).find((r) => r.id === "raise_request")
    expect(row?.cells).toEqual({ owner: true, manager: true, buyer: true, expediter: false, requester: true })
  })

  it("the team-request server lets any member create for himself — a Procurement permission is asked only to raise one ON BEHALF of somebody (REQ-03)", () => {
    const source = readFileSync(join(process.cwd(), "src/app/api/procurement/team-requests/route.ts"), "utf8")
    const create = source.slice(source.indexOf('if (data.action === "create")'), source.indexOf("const mrKey = data.id"))
    const asks = create.split(/\r?\n/).filter((line) => /caller\.can\(/.test(line))
    expect(asks).toHaveLength(1)
    expect(asks[0]).toContain("onBehalf &&")
  })
})
