// PUR-04: a free supplier's specialties are sub-categories of the material tree; the profile counts them.
import { profileChecks, profileFacts } from "@/lib/supplier-free/profile"

const specsOk = (raw: Record<string, unknown>) => profileChecks(profileFacts(raw)).find((c) => c.k === "specs")?.ok

it("specialties chosen from the tree complete the specialties step, with an older list still counting", () => {
  expect(specsOk({ specialtyIds: ["sub-rebar"], coverageCities: ["الرياض"] })).toBe(true)
  expect(specsOk({ specializations: ["حديد ومعادن"], coverageCities: ["الرياض"] })).toBe(true)
  expect(specsOk({ specialtyIds: ["sub-rebar"] })).toBe(false)
  expect(specsOk({ coverageCities: ["الرياض"] })).toBe(false)
})
