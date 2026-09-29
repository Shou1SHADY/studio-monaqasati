// Where the project's retention stands (prototype handPanel's retention row):
// held until the handover, half claimable after the provisional on a "half"
// term, half already released by Finance, claimable in full after the final,
// or fully released. The releases are Finance's facts (`pm.retentionHalfReleased`,
// `pm.retentionReleased`); the handovers are ours. Pure.

import type { Acceptances } from "./acceptance"
import type { RetentionRelease } from "./terms"

export type RetentionPhase = "held" | "half_claimable" | "half_released" | "all_claimable" | "released"

export function retentionPhase(input: { acceptances: Acceptances; release: RetentionRelease; halfReleased?: boolean; released?: boolean }): RetentionPhase {
  if (input.released) return "released"
  if (input.acceptances.final) return "all_claimable"
  if (input.halfReleased) return "half_released"
  if (input.acceptances.prov && input.release === "half") return "half_claimable"
  return "held"
}
