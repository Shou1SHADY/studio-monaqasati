import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import { messageList } from "@/lib/message-list"

describe("messageList — the pricing page's feature lists (STUDIO-MONAQASATI-1)", () => {
  it("reads an array and an object keyed by index alike", () => {
    expect(messageList(["a", "b"])).toEqual(["a", "b"])
    expect(messageList({ "0": "a", "1": "b" })).toEqual(["a", "b"])
    expect(messageList(undefined)).toEqual([])
  })

  it("every plan has its features in both languages", () => {
    for (const m of [ar, en]) {
      for (const k of ["free_features", "growth_features", "enterprise_features"] as const) {
        expect(messageList((m.Pricing as Record<string, unknown>)[k]).length).toBeGreaterThan(0)
      }
    }
  })
})
