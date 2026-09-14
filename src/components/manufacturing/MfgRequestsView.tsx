"use client"

// Manufacturing requests & cost estimates — demand from Projects, Sales and
// Procurement. Each request is screened on arrival (make-or-buy per line),
// ages visibly against the answer window, and is answered by a route: work
// orders, a cost estimate, or back to procurement — never silence. Cost
// estimates live beside them: the workshop issues cost and lead time, sales
// set the price, and the award becomes work orders here.
//
// URL: `?seg=new|estimates|answered|all` picks the segment, `?new=1` opens
// the new-request form (the shell's "Request manufacturing" button) and
// `?open=<requestId>` opens a request's drawer (Today's decisions).

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Calculator, FilePlus2, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePathname, useRouter } from "@/i18n/routing"
import type { MfgData } from "@/hooks/useMfgData"
import {
  effectiveSegment,
  inRequestSegment,
  parseRequestSegment,
  requestSegmentCounts,
  screenRequest,
  sortEstimates,
  type RequestSegment,
} from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgEmpty, MfgNote, MfgSegments, type MfgSegmentItem } from "./ui/MfgUi"
import { MfgReqCard } from "./MfgReqCard"
import { MfgReqDrawer } from "./MfgReqDrawer"
import { MfgReqAnswerForm } from "./MfgReqAnswerForm"
import { MfgReqNewForm } from "./MfgReqNewForm"
import { MfgEstimatesView } from "./MfgEstimatesView"
import { MfgEstNewForm } from "./MfgEstNewForm"
import { useNow, useScreenContext } from "./MfgReqBits"

export function MfgRequestsView({ initialSegment }: { data?: MfgData; initialSegment?: "estimates" }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = searchParams?.toString() ?? ""
  const now = useNow()
  const ctx = useScreenContext()
  const estimatesOn = data.settings.features.estimates
  const canEstimate = perms.canCost || perms.canManage

  const [segmentState, setSegment] = useState<RequestSegment>(
    () => parseRequestSegment(searchParams?.get("seg")) || initialSegment || "new"
  )
  const segment = effectiveSegment(segmentState, estimatesOn)
  const [openId, setOpenId] = useState<string | null>(null)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [showNewRequest, setShowNewRequest] = useState(false)
  const [showNewEstimate, setShowNewEstimate] = useState(false)

  // Deep links are consumed once, then dropped from the URL so the same
  // button can open the same form again.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    const key = `${params}|${perms.canRequest}`
    if (handled.current === key) return
    handled.current = key
    const sp = new URLSearchParams(params)
    const seg = parseRequestSegment(sp.get("seg"))
    if (seg) setSegment(seg)
    let consumed = false
    if (sp.get("new") === "1" && perms.canRequest) {
      setShowNewRequest(true)
      sp.delete("new")
      consumed = true
    }
    const open = sp.get("open")
    if (open) {
      setOpenId(open)
      sp.delete("open")
      consumed = true
    }
    if (consumed) {
      const rest = sp.toString()
      router.replace(rest ? `${pathname}?${rest}` : pathname)
    }
  }, [params, perms.canRequest, pathname, router])

  const counts = requestSegmentCounts(data.requests, data.estimates, estimatesOn)
  const requests = useMemo(() => {
    const list = data.requests.filter((r) => inRequestSegment(r, segment))
    // Waiting requests oldest first (the overdue ones lead); answered newest first.
    return [...list].sort((a, b) => {
      if (a.status === "new" && b.status !== "new") return -1
      if (b.status === "new" && a.status !== "new") return 1
      if (a.status === "new") return (a.requestedAt || "") < (b.requestedAt || "") ? -1 : 1
      return (a.decidedAt || a.requestedAt || "") < (b.decidedAt || b.requestedAt || "") ? 1 : -1
    })
  }, [data.requests, segment])
  const screens = useMemo(
    () => new Map(requests.filter((r) => r.status === "new").map((r) => [r.id, screenRequest(r, ctx)])),
    [requests, ctx]
  )
  const estimates = useMemo(() => sortEstimates(data.estimates), [data.estimates])

  const openRequest = openId ? data.requests.find((r) => r.id === openId) || null : null
  const answering = answeringId ? data.requests.find((r) => r.id === answeringId) || null : null

  const items: Array<MfgSegmentItem<RequestSegment>> = [
    { id: "new", label: t("mfg2_req_seg_new"), count: counts.new },
    ...(estimatesOn ? [{ id: "estimates" as const, label: t("mfg2_nav_estimates"), count: counts.estimates }] : []),
    { id: "answered", label: t("mfg2_req_seg_answered"), count: counts.answered },
    { id: "all", label: t("mfg2_req_seg_all"), count: counts.all },
  ]

  const showEstimates = () => {
    setOpenId(null)
    setSegment("estimates")
  }

  const requestCards = requests.map((r) => (
    <MfgReqCard
      key={r.id}
      request={r}
      screen={screens.get(r.id) || null}
      now={now}
      onOpen={() => setOpenId(r.id)}
      onAnswer={() => setAnsweringId(r.id)}
      onShowEstimate={showEstimates}
    />
  ))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MfgSegments label={t("mfg3_tab_requests")} value={segment} onChange={setSegment} items={items} />
        <div className="ms-auto flex flex-wrap gap-2">
          {segment === "estimates" && canEstimate && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewEstimate(true)} disabled={!data.products.length}>
              <Calculator size={14} aria-hidden="true" /> {t("mfg2_new_estimate")}
            </Button>
          )}
          {segment !== "estimates" && perms.canRequest && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowNewRequest(true)}>
              <FilePlus2 size={14} aria-hidden="true" /> {t("mfg2_new_request")}
            </Button>
          )}
        </div>
      </div>

      {segment === "new" && <MfgNote tone="info">{t("mfg2_req_window_note", { hours: data.settings.answerWindowHours })}</MfgNote>}
      {segment === "estimates" && <MfgNote tone="info">{t("mfg3_est_intro")}</MfgNote>}

      {segment === "estimates" ? (
        <MfgEstimatesView estimates={estimates} />
      ) : (
        <>
          {segment === "all" && estimatesOn && estimates.length > 0 && requests.length > 0 && (
            <h2 className="text-xs font-bold text-muted-foreground">{t("mfg3_req_heading_requests")}</h2>
          )}
          {requests.length ? (
            <div className="space-y-3">{requestCards}</div>
          ) : segment === "all" && estimatesOn && estimates.length > 0 ? null : (
            <section className="rounded-2xl border bg-white shadow-sm">
              <MfgEmpty icon={Inbox} title={t("mfg2_req_empty")} hint={segment === "new" ? t("mfg3_req_empty_new_hint") : undefined} />
            </section>
          )}
          {segment === "all" && estimatesOn && estimates.length > 0 && (
            <>
              <h2 className="pt-2 text-xs font-bold text-muted-foreground">{t("mfg2_nav_estimates")}</h2>
              <MfgEstimatesView estimates={estimates} />
            </>
          )}
        </>
      )}

      <MfgReqDrawer
        request={openRequest}
        onClose={() => setOpenId(null)}
        onAnswer={(r) => {
          setOpenId(null)
          setAnsweringId(r.id)
        }}
        onShowEstimate={showEstimates}
      />
      {answering && perms.canManage && (
        <MfgReqAnswerForm
          request={answering}
          onClose={() => setAnsweringId(null)}
          onAnswered={(route) => {
            if (route === "estimate" && estimatesOn) setSegment("estimates")
          }}
        />
      )}
      {showNewRequest && perms.canRequest && <MfgReqNewForm onClose={() => setShowNewRequest(false)} />}
      {showNewEstimate && canEstimate && <MfgEstNewForm onClose={() => setShowNewEstimate(false)} />}
    </div>
  )
}
