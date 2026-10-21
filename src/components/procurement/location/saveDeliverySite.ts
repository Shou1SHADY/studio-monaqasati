import { getAuth } from "firebase/auth"
import type { SiteInput } from "@/lib/procurement/delivery-site-input"
import { storedSites, type DeliverySite } from "@/lib/procurement/delivery-sites"

export type SaveSiteFailure = "FORBIDDEN" | "BAD_MAP_URL" | "BAD_REQUEST" | "MFG_OFF" | "FAILED"

/** One delivery site written by the server (`/api/procurement/delivery-sites`): the settings page and the editor's «+ موقع جديد». */
export async function saveDeliverySite(site: Partial<SiteInput> & Pick<SiteInput, "name" | "city">): Promise<{ site: DeliverySite } | { error: SaveSiteFailure }> {
  try {
    const token = (await getAuth().currentUser?.getIdToken()) || ""
    const res = await fetch("/api/procurement/delivery-sites", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ site }) })
    const body = (await res.json().catch(() => null)) as { data?: { site?: unknown }; code?: string } | null
    const saved = storedSites([body?.data?.site])[0]
    if (res.ok && saved) return { site: saved }
    const code = body?.code
    return { error: code === "FORBIDDEN" || code === "BAD_MAP_URL" || code === "BAD_REQUEST" || code === "MFG_OFF" ? code : "FAILED" }
  } catch {
    return { error: "FAILED" }
  }
}
