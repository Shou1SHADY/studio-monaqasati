/**
 * HR 1.0 — the statutory engine (PRD §8, §13; Saudi Labour Law arts. 53, 75, 77,
 * 84, 85, 92, 107, 117; GOSI). Every figure below is worked by hand from one
 * worker: basic 4,000 → housing 1,000 (25%) + transport 400 (10%) = wage 5,400.
 */

import { advanceInstalment, advanceMonths, gosiRates, overtimeOverCap, overtimeRate, paidDays, payFromBasic, payLine, retroDifference, wageOf, NO_ATTENDANCE } from "@/lib/hr/pay"
import { accruedDays, balanceSplit, leaveBalance, leaveDays, leaveEligibility, sickSplit } from "@/lib/hr/leave"
import { art77Compensation, fullGratuity, gratuity, leaveEncashment, monthlyEosAccrual, noticePay, resignationShare } from "@/lib/hr/eos"
import { capRemaining, cappedPenalty, objectionOnTime, penaltyAmount, penaltyStep, VIOLATIONS, type PastViolation } from "@/lib/hr/penalties"
import { docState, injuryReportDue, iqamaDueBy, legalOnSite, mayDrive, passportFirst } from "@/lib/hr/documents"
import { monthRange, resolveHrPolicies } from "@/lib/hr/statutory"

const pay = payFromBasic(4_000)

describe("wage, overtime and GOSI", () => {
  it("automatic allowances and the wage", () => {
    expect(pay).toEqual({ basic: 4_000, housing: 1_000, transport: 400 })
    expect(wageOf(pay)).toBe(5_400)
  })

  it("art. 107: (wage + ½ basic) / 240 per hour — not basic alone", () => {
    expect(overtimeRate(pay)).toBeCloseTo(30.8333, 3)
    expect(overtimeOverCap(61)).toBe(true)
    expect(overtimeOverCap(60)).toBe(false)
  })

  it("paid days: 30, or from the join date", () => {
    expect(paidDays("2026-01-10", "2026-09")).toBe(30)
    expect(paidDays("2026-09-16", "2026-09")).toBe(15)
    expect(paidDays("2026-10-01", "2026-09")).toBe(0)
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" })
  })

  it("GOSI: Saudi old 9.75/11.75, Saudi after 3 Jul 2024 10.25/12.25, non-Saudi 2% employer", () => {
    expect(gosiRates("sa", "2020-01-01")).toMatchObject({ employee: 0.0975, employer: 0.1175, scheme: "saudiOld" })
    expect(gosiRates("sa", "2025-01-01")).toMatchObject({ employee: 0.1025, employer: 0.1225, scheme: "saudiNew" })
    expect(gosiRates("bd", "2025-01-01")).toMatchObject({ employee: 0, employer: 0.02, scheme: "nonSaudi" })
  })
})

describe("the month's line (PY-01)", () => {
  it("a non-Saudi, 2 days absent, 10 h overtime, an advance instalment", () => {
    const l = payLine({ pay, nationality: "bd", join: "2024-01-01", month: "2026-09", attendance: { ...NO_ATTENDANCE, absent: 2, overtimeHours: 10 }, advance: { balance: 1_500, instalment: 540 } })
    expect(l).toMatchObject({ days: 30, monthWage: 5_400, absenceDeduction: 360, overtime: 308.33, gross: 5_348.33, gosiEmployee: 0, gosiEmployer: 100, advance: 540, net: 4_808.33 })
  })

  it("a Saudi joining mid-month: pro-rata wage and GOSI on basic + housing", () => {
    const l = payLine({ pay, nationality: "sa", join: "2026-09-16", month: "2026-09", attendance: NO_ATTENDANCE })
    expect(l).toMatchObject({ days: 15, monthWage: 2_700, gross: 2_700, gosiEmployee: 256.25, gosiEmployer: 306.25, net: 2_443.75, gosiScheme: "saudiNew" })
  })

  it("sick at 75% and unpaid days come off net; penalties too; the advance never past its balance", () => {
    const l = payLine({ pay, nationality: "bd", join: "2024-01-01", month: "2026-09", attendance: { ...NO_ATTENDANCE, sickThreeQuarters: 4, sickUnpaid: 1 }, penalties: 90, advance: { balance: 200, instalment: 540 } })
    // 180 a day: 4 × 25% × 180 = 180, + 1 × 180 = 360
    expect(l).toMatchObject({ gross: 5_400, sickDeduction: 360, penalties: 90, advance: 200, net: 4_750 })
  })

  it("art. 92: instalment 10% of the wage, never below 50; the months follow", () => {
    expect(advanceInstalment(5_400)).toBe(540)
    expect(advanceInstalment(400)).toBe(50)
    expect(advanceMonths(1_500, 5_400)).toBe(3)
  })

  it("a retro difference for one closed month (EM-04)", () => {
    expect(retroDifference(5_400, 6_000, 30)).toBe(600)
    expect(retroDifference(5_400, 6_000, 45)).toBe(600)
  })
})

describe("leave (LV-01…06)", () => {
  it("21 a year, 30 after five; the balance as of a day is accrued − taken", () => {
    // 2191 days = 6.0027 years → 21 × 5 + 30 × 1.0027 = 135.08
    expect(accruedDays("2020-09-27", "2026-09-27")).toBeCloseTo(135.08, 1)
    expect(leaveBalance("2020-09-27", "2026-09-27", 100)).toBe(35)
    expect(leaveBalance("2026-01-01", "2026-07-02", 0, 12)).toBe(22)
  })

  it("holidays inside a leave are not counted", () => {
    expect(leaveDays("2026-09-20", "2026-09-29", [{ from: "2026-09-23", days: 1 }])).toBe(9)
    expect(leaveDays("2026-09-29", "2026-09-20")).toBe(0)
  })

  it("above the balance: the balance, and the excess unpaid", () => {
    expect(balanceSplit(10, 6)).toEqual({ fromBalance: 6, excess: 4 })
    expect(balanceSplit(5, 20)).toEqual({ fromBalance: 5, excess: 0 })
  })

  it("art. 117: 30 full · 60 at 75% · 30 unpaid per service year, then HR decides", () => {
    expect(sickSplit(25, 10)).toEqual({ full: 5, threeQuarters: 5, unpaid: 0, beyond: 0 })
    expect(sickSplit(85, 40)).toEqual({ full: 0, threeQuarters: 5, unpaid: 30, beyond: 5 })
  })

  it("maternity is for women; Hajj after two years, once", () => {
    expect(leaveEligibility("maternity", { gender: "m", join: "2020-01-01" }, "2026-09-27")).toBe("female_only")
    expect(leaveEligibility("hajj", { gender: "m", join: "2025-09-27" }, "2026-09-27")).toBe("min_years")
    expect(leaveEligibility("hajj", { gender: "m", join: "2020-01-01", hajjTaken: true }, "2026-09-27")).toBe("once_taken")
    expect(leaveEligibility("annual", { gender: "m", join: "2026-01-01" }, "2026-09-27")).toBeNull()
  })
})

describe("end of service (EX-02; arts. 75, 77, 84, 85)", () => {
  it("half a month for five years, a month after", () => {
    expect(fullGratuity(5_400, 7)).toBe(24_300)
    expect(fullGratuity(5_400, 3)).toBe(8_100)
  })

  it("resignation: 0 under 2 · ⅓ to 5 · ⅔ to 10 · full", () => {
    expect([1.5, 3, 7, 12].map(resignationShare)).toEqual([0, 1 / 3, 2 / 3, 1])
    expect(gratuity(5_400, "2020-01-01", "2026-09-27", "probation")).toBe(0)
    expect(gratuity(5_400, "2025-01-01", "2026-09-27", "resignation")).toBe(0)
  })

  it("accrual /24 then /12; notice two months; art. 77 never below two months", () => {
    expect(monthlyEosAccrual(5_400, 3)).toBe(225)
    expect(monthlyEosAccrual(5_400, 6)).toBe(450)
    expect(noticePay(5_400)).toBe(10_800)
    expect(art77Compensation(5_400, 10)).toBe(27_000)
    expect(art77Compensation(5_400, 1)).toBe(10_800)
    // a fixed term: the days left on it (150 days = five months), at wage/30 a day
    expect(art77Compensation(5_400, 3, 150)).toBe(27_000)
    expect(leaveEncashment(5_400, 10)).toBe(1_800)
  })
})

describe("penalties (PN-01…04)", () => {
  const history: PastViolation[] = [
    { code: "late15", on: "2026-06-01", outcome: "applied" },
    { code: "late15", on: "2026-08-01", outcome: "applied" },
    { code: "late15", on: "2026-08-15", outcome: "cancelled" },
    { code: "late15", on: "2025-12-01", outcome: "applied" },
  ]

  it("the step counts APPLIED same-code penalties in 180 days", () => {
    expect(penaltyStep("late15", "2026-09-27", history)).toBe(2)
    expect(penaltyStep("ppe", "2026-09-27", history)).toBe(0)
    expect(penaltyStep("fighting", "2026-09-27", Array(9).fill({ code: "fighting", on: "2026-09-01", outcome: "applied" }))).toBe(3)
  })

  it("a fraction or days of a day's wage; a warning costs nothing", () => {
    expect(penaltyAmount(VIOLATIONS.late15[2], 5_400)).toBe(18)
    expect(penaltyAmount(VIOLATIONS.absentDay[1], 5_400)).toBe(360)
    expect(penaltyAmount(VIOLATIONS.late15[0], 5_400)).toBe(0)
  })

  it("five days' wage a month — reduced, not carried; objection within 15 days", () => {
    expect(capRemaining(5_400, 800)).toBe(100)
    expect(cappedPenalty(180, 5_400, 800)).toBe(100)
    expect(cappedPenalty(180, 5_400, 1_000)).toBe(0)
    expect(objectionOnTime("2026-09-12", "2026-09-27")).toBe(true)
    expect(objectionOnTime("2026-09-11", "2026-09-27")).toBe(false)
  })
})

describe("documents (DC-01…07)", () => {
  const today = "2026-09-27"
  it("state from the date; missing stays missing", () => {
    expect(docState(null, today)).toBe("missing")
    expect(docState("2026-09-26", today)).toBe("expired")
    expect(docState("2026-10-07", today)).toBe("d30")
    expect(docState("2026-11-11", today)).toBe("d60")
    expect(docState("2027-06-01", today)).toBe("valid")
  })

  it("an expired iqama blocks a site; a Saudi has none; an expired licence blocks driving only", () => {
    expect(legalOnSite({ nationality: "bd", docs: { iqama: "2026-09-01" } }, today)).toBe(false)
    expect(legalOnSite({ nationality: "sa", docs: {} }, today)).toBe(true)
    expect(mayDrive({ docs: { licence: "2026-01-01" }, drives: "licence" }, today)).toBe(false)
    expect(mayDrive({ docs: { licence: "2026-01-01" }, drives: null }, today)).toBe(true)
  })

  it("passport before iqama; iqama within 90 days of arrival; injury report in 3 working days", () => {
    expect(passportFirst({ passport: "2026-12-01", iqama: "2027-01-15" }, today)).toBe(true)
    expect(passportFirst({ passport: "2028-12-01", iqama: "2027-01-15" }, today)).toBe(false)
    expect(iqamaDueBy("2026-09-01")).toBe("2026-11-30")
    // Thursday 24 Sep → skip Fri/Sat → Sun, Mon, Tue
    expect(injuryReportDue("2026-09-24")).toBe("2026-09-29")
  })
})

describe("policies (ST-01)", () => {
  it("fall back to the defaults when missing or out of range", () => {
    expect(resolveHrPolicies(null)).toMatchObject({ housingShare: 0.25, transportShare: 0.1, payDay: 5, renewWindowDays: 60, advanceMaxMonths: 1, closeMissing: "block" })
    expect(resolveHrPolicies({ payDay: 40, housingShare: 2, closeMissing: "warn" })).toMatchObject({ payDay: 5, housingShare: 0.25, closeMissing: "warn" })
  })
})
