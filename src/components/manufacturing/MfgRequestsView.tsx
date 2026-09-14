"use client"

// Requests & cost statements (REQ). Two doors only — Sales and Procurement;
// Projects ask through Procurement and nothing is requested from inside
// Manufacturing, so there is no "new request" anywhere here (REQ-01). A
// request is read in its panel before it is answered (REQ-03); a cost
// statement carries cost, lead time and validity, and only the cost controller
// sends it (REQ-02, REQ-06). No price, no quote logging, no won/lost (D10).
//
// URL: `?seg=new|estimates|answered|all` picks the segment and
// `?open=<requestId>` opens a request's panel (Today links here).

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Inbox } from "lucide-react"
import { usePathname, useRouter } from "@/i18n/routing"
import {
  effectiveSegment,
  inRequestSegment,
  parseRequestSegment,
  requestSegmentCounts,
  sortEstimates,
  sortRequests,
  type RequestSegment,
} from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgEstimateCard, MfgRequestCard } from "./MfgReqCard"
import { MfgReqDrawer } from "./MfgReqDrawer"
import { MfgEmpty, MfgNote, MfgSegments, type MfgSegmentItem } from "./ui/MfgUi"

export function MfgRequestsView({ initialSegment }: { initialSegment?: RequestSegment }) {
  const t = useTranslations("Portal.Shared")
  const { data, today } = useMfgUi()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = searchParams?.toString() ?? ""
  const estimatesOn = data.settings.features.estimates

  const [chosen, setChosen] = useState<RequestSegment>(() => parseRequestSegment(searchParams?.get("seg")) || initialSegment || "new")
  const segment = effectiveSegment(chosen, estimatesOn)
  const [openId, setOpenId] = useState<string | null>(null)

  // Deep links are consumed once, then `open` leaves the URL so closing the
  // panel is not undone and the same link can open it again.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (handled.current === params) return
    handled.current = params
    const sp = new URLSearchParams(params)
    const seg = parseRequestSegment(sp.get("seg"))
    if (seg) setChosen(seg)
    const open = sp.get("open")
    if (open) {
      setOpenId(open)
      sp.delete("open")
      const rest = sp.toString()
      router.replace(rest ? `${pathname}?${rest}` : pathname)
    }
  }, [params, pathname, router])

  const counts = requestSegmentCounts(data.requests, data.estimates, estimatesOn, today, data.settings)
  const requests = useMemo(() => sortRequests(data.requests.filter((r) => inRequestSegment(r, segment))), [data.requests, segment])
  const estimates = useMemo(
    () => (estimatesOn && (segment === "estimates" || segment === "all") ? sortEstimates(data.estimates, today, data.settings) : []),
    [estimatesOn, segment, data.estimates, today, data.settings]
  )

  const items: Array<MfgSegmentItem<RequestSegment>> = [
    { id: "new", label: t("mfr_seg_new"), count: counts.new },
    ...(estimatesOn ? [{ id: "estimates" as const, label: t("mfr_seg_estimates"), count: counts.estimates }] : []),
    { id: "answered", label: t("mfr_seg_answered"), count: counts.answered },
    { id: "all", label: t("mfr_seg_all"), count: counts.all },
  ]

  const requestOf = (id: string | null) => (id ? data.requests.find((r) => r.id === id) : undefined)

  return (
    <div className="space-y-4">
      <MfgSegments label={t("mfr_segments_label")} value={segment} onChange={setChosen} items={items} />

      {segment === "new" && <MfgNote tone="info">{t("mfr_two_doors_note", { hours: data.settings.answerWindowHours })}</MfgNote>}
      {segment === "estimates" && <MfgNote tone="info">{t("mfr_estimates_note")}</MfgNote>}

      {estimates.length > 0 && (
        <div className="space-y-3">
          {estimates.map((e) => (
            <MfgEstimateCard key={e.id} estimate={e} onOpen={requestOf(e.requestId) ? () => setOpenId(e.requestId) : undefined} />
          ))}
        </div>
      )}
      {requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((r) => (
            <MfgRequestCard key={r.id} request={r} onOpen={() => setOpenId(r.id)} />
          ))}
        </div>
      )}
      {estimates.length === 0 && requests.length === 0 && (
        <section className="rounded-2xl border bg-white shadow-sm">
          <MfgEmpty icon={Inbox} title={t("mfr_empty")} hint={segment === "new" ? t("mfr_empty_new_hint") : undefined} />
        </section>
      )}

      <MfgReqDrawer requestId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
