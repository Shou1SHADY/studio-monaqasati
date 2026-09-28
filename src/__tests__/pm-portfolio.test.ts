import {
  activeFilters,
  archiveCsvHead,
  archiveCsvRows,
  archiveSortsFor,
  archiveKpis,
  filterOptions,
  filtersFor,
  inPortfolioState,
  portfolioCounts,
  portfolioList,
  sortArchive,
  toCsv,
  toggleOption,
  type PortfolioRow,
} from "@/lib/pm/portfolio"
import {
  acceptStepBlocks,
  boqSourcesFor,
  detectedGaps,
  handoverCandidates,
  inboxKpis,
  mayActOnHandover,
  openReturns,
  type PmHandover,
} from "@/lib/pm/handover"

const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  id: "p",
  no: null,
  noDisplay: null,
  name: "Project",
  client: null,
  kind: "bld",
  region: "Riyadh",
  managerId: "u1",
  managerName: "Abdullah",
  lifecycle: "live",
  value: 0,
  fin: null,
  ...over,
})

const rows: PortfolioRow[] = [
  row({ id: "a", name: "Al-Yasmin Compound", no: "PJ-2026/001", noDisplay: "م-2026/001", client: "Yasmin Dev", lifecycle: "live", value: 100 }),
  row({ id: "b", name: "Water plant", kind: "mep", region: "Qassim", managerId: "u2", lifecycle: "hold", value: 50 }),
  row({ id: "c", name: "School", lifecycle: "plan" }),
  row({ id: "d", name: "Tower", lifecycle: "done" }),
  row({ id: "e", name: "Old villa", lifecycle: "closed", fin: { contractValue: 900, cost: 800, contractDays: 300, actualDays: 320, delayDays: 20, closedOn: "2025-04-01", retentionHeld: 45 } }),
  row({ id: "f", name: "Old road", kind: "road", lifecycle: "closed", fin: { contractValue: 400, cost: null, contractDays: 200, actualDays: 190, delayDays: 0, closedOn: "2026-02-10", retentionHeld: 20 } }),
]

describe("portfolio states (G-20, G-29)", () => {
  it("«الكل» leaves the archive out; the archive chip holds only closed projects", () => {
    expect(inPortfolioState("closed", "all")).toBe(false)
    expect(inPortfolioState("done", "all")).toBe(true)
    expect(portfolioCounts(rows)).toEqual({ all: 4, live: 1, hold: 1, plan: 1, done: 1, arch: 2 })
    expect(portfolioList(rows, { st: "all", sel: {}, q: "" }).map((r) => r.id)).toEqual(["a", "b", "c", "d"])
    expect(portfolioList(rows, { st: "arch", sel: {}, q: "" }).map((r) => r.id)).toEqual(["e", "f"])
  })
})

describe("filters and search (G-21, G-23)", () => {
  it("multi-select: OR inside a filter, AND across filters; the close year only in the archive", () => {
    expect(filtersFor("all")).toEqual(["kind", "reg", "pm"])
    expect(filtersFor("arch")).toContain("yr")
    let sel = toggleOption({}, "kind", "bld")
    sel = toggleOption(sel, "kind", "mep")
    expect(portfolioList(rows, { st: "all", sel, q: "" })).toHaveLength(4)
    sel = toggleOption(sel, "reg", "Qassim")
    expect(portfolioList(rows, { st: "all", sel, q: "" }).map((r) => r.id)).toEqual(["b"])
    expect(activeFilters(sel, "all")).toBe(2)
    expect(toggleOption(sel, "kind", "bld").kind).toEqual(["mep"])
    expect(filterOptions(rows, "arch", "yr")).toEqual(["2026", "2025"])
    expect(portfolioList(rows, { st: "arch", sel: { yr: ["2025"] }, q: "" }).map((r) => r.id)).toEqual(["e"])
  })

  it("searches name, number (stored and shown), client and region", () => {
    expect(portfolioList(rows, { st: "all", sel: {}, q: "2026/001" }).map((r) => r.id)).toEqual(["a"])
    expect(portfolioList(rows, { st: "all", sel: {}, q: "yasmin dev" }).map((r) => r.id)).toEqual(["a"])
    expect(portfolioList(rows, { st: "all", sel: {}, q: "qassim" }).map((r) => r.id)).toEqual(["b"])
  })
})

describe("the archive (G-22)", () => {
  const archived = rows.filter((r) => r.lifecycle === "closed")
  it("sorts recently closed, by value, by margin, by delay", () => {
    expect(sortArchive(archived, "d").map((r) => r.id)).toEqual(["f", "e"])
    expect(sortArchive(archived, "v").map((r) => r.id)).toEqual(["e", "f"])
    expect(sortArchive(archived, "m").map((r) => r.id)).toEqual(["e", "f"])
    expect(sortArchive(archived, "l").map((r) => r.id)).toEqual(["e", "f"])
  })

  it("KPIs never invent a cost: no margin while any project lacks one", () => {
    expect(archiveKpis(archived, 2)).toMatchObject({ count: 2, of: 2, value: 1300, cost: null, marginPct: null, late: 1 })
    expect(archiveKpis([archived[0]], 2)).toMatchObject({ cost: 800, marginPct: 11.1 })
  })

  it("CSV: BOM, quoted cells, raw numbers", () => {
    const csv = toCsv([["No.", "Project"], ...archiveCsvRows([archived[0]], { kind: (k) => k ?? "", manager: (r) => r.managerName ?? "" }, true)])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"900","800","11.1","320","300","2025-04-01","Abdullah"')
    expect(toCsv([['say "hi"']])).toContain('"say ""hi"""')
  })

  it("P0: without money the archive offers no value/margin sort and exports no contract, cost or margin", () => {
    expect(archiveSortsFor(false)).toEqual(["d", "l"])
    expect(archiveSortsFor(true)).toEqual(["d", "v", "m", "l"])
    expect(archiveCsvHead(false)).toEqual(["no", "project", "client", "kind", "region", "actual_days", "contract_days", "closed", "manager"])
    expect(archiveCsvHead(true)).toHaveLength(12)
    const row = archiveCsvRows([archived[0]], { kind: (k) => k ?? "", manager: (r) => r.managerName ?? "" }, false)[0]
    expect(row).toHaveLength(9)
    expect(row).not.toContain(900)
    expect(row).not.toContain(800)
    expect(row).not.toContain(11.1)
  })
})

const ho = (over: Partial<PmHandover>): PmHandover =>
  ({
    id: "h",
    organizationId: "o",
    status: "wait",
    to: "pm1",
    toName: "A",
    opportunityId: "opp",
    title: "T",
    value: 100,
    durationDays: 30,
    signedOn: "2026-09-01",
    startOn: "2026-12-01",
    createdAt: "2026-09-20T10:00:00Z",
    ...over,
  }) as PmHandover

describe("the handover inbox (G-30…G-41)", () => {
  it("the owner acts on any file; others only on their own", () => {
    expect(mayActOnHandover({ uid: "x", owner: true }, ho({}))).toBe(true)
    expect(mayActOnHandover({ uid: "pm1", owner: false }, ho({}))).toBe(true)
    expect(mayActOnHandover({ uid: "pm2", owner: false }, ho({}))).toBe(false)
  })

  it("a returned file stays listed until CRM sends the same deal again", () => {
    const ret = ho({ id: "r", status: "ret" })
    expect(openReturns([ret]).map((h) => h.id)).toEqual(["r"])
    expect(openReturns([ret, ho({ id: "n", createdAt: "2026-09-25T10:00:00Z" })])).toEqual([])
  })

  it("KPIs: waiting with the oldest age, starting within three weeks, incomplete", () => {
    const k = inboxKpis([ho({ startOn: "2026-10-01" }), ho({ id: "2", value: 0, createdAt: "2026-09-10T00:00:00Z" })], "2026-09-28")
    expect(k).toEqual({ waiting: 2, oldest: 18, rush: 1, incomplete: 1 })
  })

  it("return: the gaps the system already sees", () => {
    expect(detectedGaps(ho({ value: 0, signedOn: null }))).toEqual(["no_value", "not_signed"])
  })

  it("BOQ source: the winning bid only when CRM attached one; saving waits for a source and a manager", () => {
    expect(boqSourcesFor(ho({}))).toEqual(["xl", "man", "later"])
    expect(boqSourcesFor(ho({ boq: [{ code: "1", descriptionAr: "x", unit: "m", quantity: 2, rate: 5 }] }))[0]).toBe("crm")
    expect(acceptStepBlocks({ source: null, managerUid: "u", xlItems: 0 })).toEqual(["no_boq_source"])
    expect(acceptStepBlocks({ source: "xl", managerUid: null, xlItems: 0 })).toEqual(["no_manager", "no_boq_file"])
    expect(acceptStepBlocks({ source: "later", managerUid: "u", xlItems: 0 })).toEqual([])
  })

  it("reassign candidates: approvers only, not the current manager, least loaded first", () => {
    const c = handoverCandidates(
      [
        { uid: "pm1", name: "A", approves: true, owner: false, limit: 75000 },
        { uid: "pm2", name: "B", approves: true, owner: false, limit: 75000 },
        { uid: "own", name: "C", approves: true, owner: true, limit: Infinity },
        { uid: "se", name: "D", approves: false, owner: false, limit: 0 },
      ],
      [
        { managerId: "pm2", lifecycle: "live" },
        { managerId: "pm2", lifecycle: "live" },
        { managerId: "own", lifecycle: "live" },
        { managerId: "own", lifecycle: "done" },
      ],
      "pm1"
    )
    expect(c.map((x) => [x.uid, x.live, x.seat])).toEqual([
      ["own", 1, "owner"],
      ["pm2", 2, "pm"],
    ])
  })
})
