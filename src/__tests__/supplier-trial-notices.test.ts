/** @jest-environment node */
/**
 * The daily job that tells a supplier its paid-plan trial is over: once per trial, only for a plan that is «full» with an end in
 * the past, never for a plain subscription or a trial still running, and again only after a NEW trial replaces the document.
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { runSupplierTrialNotices } from "@/lib/supplier-trial-notices"

const db = new FakeAdminDb()
const NOW = new Date("2026-11-10T09:00:00.000Z")
const notices = (uid: string) => db.list(`users/${uid}/notifications`)

beforeEach(() => {
  db.docs.clear()
  for (const id of ["s1", "s2", "s3", "s4"]) db.seed(`users/${id}`, { role: "Supplier", organizationId: id })
  db.seed("companyPlans/s1", { organizationId: "s1", supplierPlan: "full", planTrialEndsAt: "2026-11-09T09:00:00.000Z" })
  db.seed("companyPlans/s2", { organizationId: "s2", supplierPlan: "full", planTrialEndsAt: "2026-11-12T09:00:00.000Z" })
  db.seed("companyPlans/s3", { organizationId: "s3", supplierPlan: "full" })
  db.seed("companyPlans/s4", { organizationId: "s4", supplierPlan: "free", planTrialEndsAt: "2026-11-01T09:00:00.000Z" })
})

describe("the supplier trial-ended notice", () => {
  it("tells only the supplier whose paid trial has ended, in the proc-event shape (keys for both languages)", async () => {
    expect(await runSupplierTrialNotices(db as never, NOW)).toEqual({ ended: 1, told: 1 })
    expect(notices("s1")).toHaveLength(1)
    expect(notices("s1")[0]).toMatchObject({ type: "plan_trial_ended", userId: "s1", link: "/supplier", read: false, i18n: { title: "pn_plan_trial_ended_title", message: "pn_plan_trial_ended" } })
    for (const quiet of ["s2", "s3", "s4"]) expect(notices(quiet)).toHaveLength(0)
  })

  it("says it once: a second run, or an overlapping one, tells nobody again", async () => {
    await runSupplierTrialNotices(db as never, NOW)
    expect(await runSupplierTrialNotices(db as never, NOW)).toEqual({ ended: 0, told: 0 })
    expect(notices("s1")).toHaveLength(1)
    expect(db.get("companyPlans/s1")).toMatchObject({ planTrialNotifiedAt: NOW.toISOString() })
  })

  it("tells a trial that ends later when its day comes", async () => {
    await runSupplierTrialNotices(db as never, NOW)
    expect(await runSupplierTrialNotices(db as never, new Date("2026-11-13T09:00:00.000Z"))).toEqual({ ended: 1, told: 1 })
    expect(notices("s2")).toHaveLength(1)
  })

  it("a new trial (the plan document replaced) can be told again", async () => {
    await runSupplierTrialNotices(db as never, NOW)
    db.seed("companyPlans/s1", { organizationId: "s1", supplierPlan: "full", planTrialEndsAt: "2026-11-10T08:00:00.000Z" })
    expect(await runSupplierTrialNotices(db as never, NOW)).toEqual({ ended: 1, told: 1 })
    expect(notices("s1")).toHaveLength(2)
  })

  it("a company with no owner account (a secondary company) is stamped and nobody is written to", async () => {
    db.docs.delete("users/s1")
    expect(await runSupplierTrialNotices(db as never, NOW)).toEqual({ ended: 1, told: 0 })
    expect(notices("s1")).toHaveLength(0)
  })
})
