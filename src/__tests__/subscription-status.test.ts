/** AD-03 — a contractor's subscription status: «trial» only when stored so; anything else, or nothing, is Active. */
import { SUBSCRIPTION_STATUSES, subscriptionStatusOf } from "@/lib/subscription-status"

describe("subscriptionStatusOf", () => {
  it("no field, or anything unknown, is Active; «trial» is Trial", () => {
    expect([undefined, null, "", "paid", 1, "active"].map(subscriptionStatusOf)).toEqual(["active", "active", "active", "active", "active", "active"])
    expect(subscriptionStatusOf("trial")).toBe("trial")
    expect(SUBSCRIPTION_STATUSES).toEqual(["active", "trial"])
  })
})
