/** AD-03 — a contractor's subscription status: «trial» only when stored so; anything else, or nothing, is Active. */
import { SUBSCRIPTION_STATUSES, TRIAL_DEFAULT_DAYS, parseTrialDays, subscriptionStateOf, subscriptionStatusOf, trialWindow } from "@/lib/subscription-status"

describe("subscriptionStatusOf", () => {
  it("no field, or anything unknown, is Active; «trial» is Trial", () => {
    expect([undefined, null, "", "paid", 1, "active"].map(subscriptionStatusOf)).toEqual(["active", "active", "active", "active", "active", "active"])
    expect(subscriptionStatusOf("trial")).toBe("trial")
    expect(SUBSCRIPTION_STATUSES).toEqual(["active", "trial"])
  })
})

describe("a trial has a length", () => {
  const start = new Date("2026-11-01T09:00:00.000Z")

  it("the default is two weeks, and the window runs from the start for exactly that many days", () => {
    expect(TRIAL_DEFAULT_DAYS).toBe(14)
    expect(trialWindow(14, start)).toEqual({ trialDays: 14, trialStartedAt: "2026-11-01T09:00:00.000Z", trialEndsAt: "2026-11-15T09:00:00.000Z", trialEndsMs: 1794733200000 })
  })

  it("is running before its end, counts days left rounded up, and is expired from the instant it ends", () => {
    const stored = { subscription: "trial", trialEndsAt: trialWindow(14, start).trialEndsAt }
    expect(subscriptionStateOf(stored, start)).toEqual({ phase: "trial", endsAt: "2026-11-15T09:00:00.000Z", daysLeft: 14 })
    expect(subscriptionStateOf(stored, new Date("2026-11-14T10:00:00.000Z")).daysLeft).toBe(1)
    expect(subscriptionStateOf(stored, new Date("2026-11-15T08:59:59.000Z")).phase).toBe("trial")
    expect(subscriptionStateOf(stored, new Date("2026-11-15T09:00:00.000Z"))).toEqual({ phase: "expired", endsAt: "2026-11-15T09:00:00.000Z", daysLeft: 0 })
    expect(subscriptionStateOf(stored, new Date("2027-01-01T00:00:00.000Z")).phase).toBe("expired")
  })

  it("a trial with no end (set before trials had a length) never expires; Active never does either", () => {
    const later = new Date("2030-01-01")
    expect(subscriptionStateOf({ subscription: "trial" }, later)).toEqual({ phase: "trial", endsAt: null, daysLeft: null })
    expect(subscriptionStateOf({ subscription: "trial", trialEndsAt: "not a date" }, later).phase).toBe("trial")
    expect(subscriptionStateOf({ subscription: "active", trialEndsAt: "2020-01-01T00:00:00.000Z" }, later).phase).toBe("active")
    expect(subscriptionStateOf(null, later).phase).toBe("active")
    expect(subscriptionStateOf(undefined, later).phase).toBe("active")
  })

  it("reads a typed length: whole days from 1 to 365", () => {
    expect(["1", "14", "365", " 30 "].map(parseTrialDays)).toEqual([1, 14, 365, 30])
    expect(["", "0", "366", "2.5", "-3", "abc"].map(parseTrialDays)).toEqual([null, null, null, null, null, null])
  })
})
