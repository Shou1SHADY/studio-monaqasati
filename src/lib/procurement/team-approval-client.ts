// The browser's side of the team-approval acts (/api/procurement/team-requests, REQ-05): the requests still before Procurement the
// signed-in member may read, approve · return · withdraw · send again, and the owner's release when he turns the policy off.

import { getAuth } from "firebase/auth"
import type { ReturnReason, TeamApprovalView } from "./team-approval"

const URL_ = "/api/procurement/team-requests"

async function token(): Promise<string> {
  try {
    return (await getAuth().currentUser?.getIdToken()) || ""
  } catch {
    return ""
  }
}

export async function fetchTeamApprovals(): Promise<TeamApprovalView[] | null> {
  const t = await token()
  if (!t) return null
  try {
    const res = await fetch(URL_, { headers: { Authorization: `Bearer ${t}` } })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { approvals?: TeamApprovalView[] } }
    return json.data?.approvals ?? []
  } catch {
    return null
  }
}

export type TeamActResult = { ok: true } | { ok: false; code: string }

async function post(body: Record<string, unknown>): Promise<TeamActResult> {
  try {
    const res = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) })
    if (res.ok) return { ok: true }
    const json = (await res.json().catch(() => null)) as { code?: string } | null
    return { ok: false, code: json?.code || "FAILED" }
  } catch {
    return { ok: false, code: "FAILED" }
  }
}

export const approveTeamRequestCall = (id: string) => post({ action: "approve", id })
export const returnTeamRequestCall = (id: string, code: ReturnReason, note: string | null) => post({ action: "return", id, code, note })
export const withdrawTeamRequestCall = (mrKey: string) => post({ action: "withdraw", id: mrKey })
export async function releaseTeamApprovals(): Promise<TeamActResult> {
  return post({ action: "release" })
}
