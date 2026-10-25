"use client"

// The RFQ's one page (Procurement 2.0 RFQ-01…15): its name, the three-segment path, the numbers, and four tabs — العروض ·
// المقارنة · الاستفسارات · التفاصيل. The offers arrive with their prices and are compared at once (no seal); the award is the
// review's, opened from the offer panel or the comparison. This component only gathers: every reading is `useRfqWorld`'s, every
// act is a server route.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { arrayRemove, deleteDoc, doc, updateDoc } from "firebase/firestore"
import { ArrowRight, Bell, Link2, Loader2, Scale, TrendingUp } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { ProjectChangedFlag } from "@/components/procurement/ProjectChangedFlag"
import { RfqNumber } from "@/components/procurement/RfqCard"
import { printRfqWithLink, rfqPrintModel } from "@/components/procurement/RfqPrint"
import { LinkComposer } from "@/components/procurement/rfq/LinkComposer"
import { GuestNotifyDialog, type GuestNotifyTarget } from "@/components/contractor/GuestNotifyDialog"
import { useUser, useFirestore } from "@/firebase"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { useRfqWorld, type AwardSelection } from "@/hooks/useRfqWorld"
import { useToast } from "@/hooks/use-toast"
import { useRouter, Link } from "@/i18n/routing"
import { printedNumber } from "@/lib/company-print-profile"
import { displayCity } from "@/lib/constants"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { displayDocNumber } from "@/lib/procurement/format"
import { unlinkNeedsFromRfq } from "@/lib/procurement/needs-writes"
import { DecisionRefused, decideOffer } from "@/lib/procurement/offer-decisions-client"
import { invitedRows } from "@/lib/procurement/rfq-detail"
import { noLiveOffer } from "@/lib/procurement/rfq-no-live"
import { logRfqDocument } from "@/lib/procurement/rfq-writes"
import { actsOnRfq } from "@/lib/procurement/rfq-access"
import { awardSupplierOrgId } from "@/lib/procurement/award"
import { rfqNeedSources, rfqPageTab, type NeedLinkedRfq, type RfqPageTab } from "@/lib/procurement/rfq-view"
import { pricingModeOf } from "@/lib/procurement/offer-calc"
import type { OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import { cn } from "@/lib/utils"
import { RfqDetailsPanel, RfqDraftPanel, RfqInvitedList } from "./RfqDetailsPanel"
import { RfqGuestLinkPanel, type GuestLinkPhase } from "./RfqGuestLinkPanel"
import { guestLinkUrl } from "./guestLinkUrl"
import { RfqManualOfferDialog } from "./RfqManualOfferDialog"
import { RfqRegisterGuestDialog, type GuestToRegister } from "./RfqRegisterGuestDialog"
import { BafoDialog, ClarifyDialog, ExcludeDialog, RevalDialog } from "./OfferDecisionDialogs"
import { OfferSampleDialog } from "./OfferSampleDialog"
import { RfqBestCards } from "./RfqBestCards"
import { RfqCompare } from "./RfqCompare"
import { RfqInquiriesTab } from "./RfqInquiriesTab"
import { NoLiveBanner } from "./NoLiveBanner"
import { RfqLifecycleBar } from "./RfqLifecycleBar"
import { RfqNumbersRow } from "./RfqNumbersRow"
import { RfqOfferDrawer } from "./RfqOfferDrawer"
import { RfqOfferList } from "./RfqOfferList"
import { RfqPathHeader } from "./RfqPathHeader"
import { RfqRequestsPanel, RfqTermsPanel, useRfqDelivery } from "./RfqTermsPanel"
import { RfqTitleEdit } from "./RfqTitleEdit"
import { requestExtend, requestRemind } from "./rfqPageEvents"
import type { RfqView } from "./rfqOfferView"

const STAGE_TONE: Record<string, PillTone> = { draft: "mute", open: "info", compare: "warn", awarded: "ok", cancelled: "mute" }

export function RfqPage({ rfqId }: { rfqId: string }) {
  const t = useTranslations("Portal.Procurement.rfqpage")
  const tc = useTranslations("Portal.Contractor")
  const tx = useTranslations("Portal.Procurement.rfqx")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user } = useUser()
  const searchParams = useSearchParams()
  const world = useRfqWorld(rfqId)
  const { rfq, access, state, today } = world
  const activeCompanyName = useActiveCompanyName(world.profile as never, user?.uid)
  const print = usePrintProfile()

  const paramTab = searchParams.get("tab")
  const [userTab, setUserTab] = useState<RfqPageTab | null>(null)
  useEffect(() => {
    if (paramTab) setUserTab(rfqPageTab(paramTab))
  }, [paramTab])
  const tab: RfqPageTab = userTab ?? (state.stage === "compare" ? "compare" : "list")

  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [excludeRow, setExcludeRow] = useState<OfferRowModel | null>(null)
  const [clarifyRow, setClarifyRow] = useState<OfferRowModel | null>(null)
  const [bafoRow, setBafoRow] = useState<OfferRowModel | null>(null)
  const [revalRow, setRevalRow] = useState<OfferRowModel | null>(null)
  const [sampleRow, setSampleRow] = useState<OfferRowModel | null>(null)
  const [selection, setSelection] = useState<AwardSelection | null>(null)
  // «اختر الأقل لكل بند» from the best cards: the comparison applies it and clears it.
  const [lowestRequest, setLowestRequest] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [registerGuest, setRegisterGuest] = useState<GuestToRegister | null>(null)
  const [guestNotify, setGuestNotify] = useState<GuestNotifyTarget | null>(null)
  const [draftDeleteOpen, setDraftDeleteOpen] = useState(false)
  const [deletingDraft, setDeletingDraft] = useState(false)

  const fallbackName = tc("offers_registered_supplier")
  const rows = world.rows
  const drawerRow = useMemo(() => rows.find((r) => r.id === drawerId) || null, [rows, drawerId])
  const projectName = world.project?.name || null
  const stageLabel = t(`stage.${state.stage}`)
  const offPlatform = rows.filter((r) => r.origin === "guest").length
  const open = state.stage === "open" || state.stage === "compare"
  const rfqView = (rfq as RfqView | null) || null
  const noLive = useMemo(() => (rfq ? noLiveOffer(rfq, world.offers, world.decisions) : null), [rfq, world.offers, world.decisions])
  const noLiveBanner = noLive && rfq && access.acts ? <NoLiveBanner rfq={rfq} actor={world.runner} reason={noLive} /> : null
  const delivery = useRfqDelivery((rfq || { id: rfqId }) as RfqView)
  const canRemind = Boolean(rfq && state.stage === "open" && actsOnRfq(rfq, world.runner))
  const pickLowest = () => {
    setLowestRequest(Date.now())
    setUserTab("compare")
  }
  const supplierOf = (row: OfferRowModel) => {
    const id = awardSupplierOrgId(row.offer as never)
    return { verified: world.verifiedOf(id), orders: world.experienceOf(id).orders }
  }
  const askRevalOf = (offerId: string) => {
    const row = rows.find((r) => r.id === offerId)
    if (row) setRevalRow(row)
  }
  const showRequests = () => {
    setUserTab("details")
    window.requestAnimationFrame(() => document.getElementById("rfq-requests")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const linkPhase: GuestLinkPhase =
    state.stage === "open"
      ? { kind: "open", until: rfq?.deadline ? rfq.deadline.slice(0, 10) : null }
      : state.stage === "cancelled"
        ? { kind: "closed", on: rfq?.cancellation?.at ? rfq.cancellation.at.slice(0, 10) : null, how: "cancelled" }
        : state.closedEarly && rfq?.closedEarly?.at
          ? { kind: "closed", on: rfq.closedEarly.at.slice(0, 10), how: "award" }
          : { kind: "closed", on: rfq?.deadline ? rfq.deadline.slice(0, 10) : null, how: "deadline" }

  const showError = (err: unknown) => {
    const code = err instanceof DecisionRefused ? err.code : "INTERNAL"
    toast({ title: tc("offers_toast_error"), description: t.has(`err.${code}`) ? t(`err.${code}`) : t("err.generic"), variant: "destructive" })
  }

  const toggleShortlist = async (row: OfferRowModel) => {
    try {
      await decideOffer({ action: row.shortlisted ? "unshortlist" : "shortlist", offerId: row.id })
      toast({ title: row.shortlisted ? t("toast.unshortlisted") : t("toast.shortlisted") })
    } catch (err) {
      showError(err)
    }
  }

  const restore = async (row: OfferRowModel) => {
    try {
      await decideOffer({ action: "restore", offerId: row.id })
      toast({ title: t("toast.restored") })
    } catch (err) {
      showError(err)
    }
  }

  const reachGuest = (row: OfferRowModel, note?: string | null) => {
    setGuestNotify({ offerId: row.id, supplierName: row.name || fallbackName, rfqTitle: rfq?.title || "", event: "reduction_requested", note: note || null, targetPrice: null })
  }

  const award = (sel: AwardSelection) => {
    setDrawerId(null)
    setSelection(sel)
    setUserTab("compare")
  }

  const printDoc = async () => {
    if (!rfqView) return
    const p = (world.profile || {}) as { companyName?: string; name?: string; taxNumber?: string; crNumber?: string }
    const number = rfqView.rfqNumber ? displayDocNumber(rfqView.rfqNumber, locale) : `#${rfqId.slice(0, 6)}`
    const model = rfqPrintModel(rfqView as unknown as Parameters<typeof rfqPrintModel>[0], { name: p.companyName || world.orgName || p.name || "", vat: printedNumber(p.taxNumber, print.taxNumber), cr: printedNumber(p.crNumber, print.crNumber) }, number, displayCity(rfqView.city || "", locale))
    const link = access.acts ? guestLinkUrl(user, { id: rfqId, status: rfqView.status, directAward: rfqView.directAward }) : Promise.resolve(null)
    if (!(await printRfqWithLink(model, locale, (k, params) => tProc(`rfqpo.print.${k}`, params), link))) {
      toast({ title: tProc("rfqpo.popup_blocked"), variant: "destructive" })
      return
    }
    if (firestore && access.acts) void logRfqDocument(firestore, world.runner, rfqId).catch((err) => console.warn("print not logged:", (err as { code?: string })?.code || err))
  }

  const deleteDraft = async () => {
    if (!firestore || !rfqView || rfqView.status !== "Draft") return
    setDeletingDraft(true)
    try {
      if (rfqView.projectId) {
        await releaseBoqDrawsForRfq(firestore, rfqView.projectId, rfqId)
        await updateDoc(doc(firestore, "projects", rfqView.projectId), { rfqIds: arrayRemove(rfqId) })
      }
      const stuck = await unlinkNeedsFromRfq(firestore, rfqId, rfqNeedSources(rfqView as unknown as NeedLinkedRfq))
      await deleteDoc(doc(firestore, "rfqs", rfqId))
      toast({ title: tc("rfq_delete_success"), description: stuck > 0 ? tProc("p2c.rfq.needs_not_released", { count: stuck }) : undefined })
      router.push("/contractor/rfqs")
    } catch (err) {
      console.error("draft not deleted:", (err as { code?: string })?.code || err)
      toast({ title: tc("rfq_delete_failed"), variant: "destructive" })
    } finally {
      setDeletingDraft(false)
      setDraftDeleteOpen(false)
    }
  }

  if (!world.loading && rfq && world.orgId && rfq.organizationId !== world.orgId && !access.isPlatformAdmin) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center gap-4 p-20 text-center">
          <h2 className="text-xl font-bold">{tc("offers_access_denied_title")}</h2>
          <p className="max-w-md text-muted-foreground">{tc("offers_access_denied_desc")}</p>
          <Button onClick={() => router.push("/contractor/rfqs")}>{t("back")}</Button>
        </div>
      </PortalLayout>
    )
  }

  const unanswered = world.inquiryCounts.unanswered
  const audience = rfq?.directAward ? "direct" : rfq?.visibility === "private" ? "private" : "public"
  const deadlineText = rfq?.deadline ? rfq.deadline.slice(0, 10) : ""

  return (
    <PortalLayout>
      <div className="space-y-4 text-start">
        <Link href="/contractor/rfqs" className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight size={14} className="rotate-180 rtl:rotate-0" aria-hidden="true" />
          {t("back")}
        </Link>

        {world.loading || !rfq ? (
          <div className="flex flex-col items-center justify-center gap-3 p-20 text-muted-foreground">
            <Loader2 className="animate-spin" size={36} aria-hidden="true" />
            <p>{tc("offers_loading")}</p>
          </div>
        ) : (
          <>
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <RfqNumber rfq={{ id: rfqId, rfqNumber: rfq.rfqNumber ?? null }} />
                <StatusPill tone={STAGE_TONE[state.stage] ?? "mute"}>{stageLabel}</StatusPill>
                {state.closedEarly && state.stage === "awarded" && <StatusPill tone="warn">{t("stage.early")}</StatusPill>}
                <StatusPill tone="mute">{t(`audience.${audience}`)}</StatusPill>
                <StatusPill tone="mute">{t(`pricing.${pricingModeOf(rfq as never)}`)}</StatusPill>
                {rfq.directAward && rfqView?.dirOver && <StatusPill tone="warn">{tProc("rfqd.details.direct_over_short")}</StatusPill>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <RfqTitleEdit rfqId={rfqId} title={rfq.title || ""} canEdit={access.acts && state.stage !== "cancelled"} />
                <div className="flex flex-wrap items-center gap-2">
                  {world.offers.length > 0 && state.stage !== "awarded" && state.stage !== "cancelled" && state.stage !== "draft" && access.canDecide && tab !== "compare" && (
                    <Button type="button" className="gap-2" onClick={() => setUserTab("compare")}>
                      <Scale size={14} aria-hidden="true" />
                      {t("compare_cta")}
                    </Button>
                  )}
                  {access.acts && open && !rfq.directAward && (
                    <Button type="button" variant="outline" className="gap-2" onClick={() => setShareOpen(true)}>
                      <Link2 size={14} aria-hidden="true" />
                      {t("guest_link")}
                    </Button>
                  )}
                  <RfqLifecycleBar rfq={rfq} actor={world.runner} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground" dir="auto">
                {t("sub", {
                  count: rfq.products?.length || 1,
                  place: [...(delivery.places.length ? delivery.places : [[displayCity(rfq.city || "", locale), rfq.district ? displayCity(rfq.district, locale) : ""].filter(Boolean).join(" · ")]), ...delivery.optionLines].filter(Boolean).join(" · "),
                })}
              </p>
              <ProjectChangedFlag from={rfq} />
            </header>

            {access.ownerReads && <Callout tone="info">{tx("owner_reads")}</Callout>}
            {access.notMine && <Callout tone="info">{tx("not_mine", { name: rfq.createdByUserName || "—" })}</Callout>}

            {state.stage === "draft" ? (
              <RfqDraftPanel rfq={rfq} projectName={projectName} editHref={`/contractor/rfqs/new?edit=${rfqId}`} canAct={access.acts} deleting={deletingDraft} onDelete={() => setDraftDeleteOpen(true)} />
            ) : (
              <>
                <RfqPathHeader path={world.path} stage={state.stage} onMoreRequests={showRequests} />
                <RfqNumbersRow
                  reached={typeof (rfq as { reachedCount?: number }).reachedCount === "number" ? (rfq as { reachedCount?: number }).reachedCount ?? null : null}
                  views={Number((rfq as { viewsCount?: number }).viewsCount) || 0}
                  offers={world.offers.length}
                  offPlatform={offPlatform}
                  lowestGrossH={world.lowestCompleteGrossH}
                  showPrices={access.seesPrices}
                  unanswered={unanswered}
                  onOpenInquiries={() => setUserTab("inquiries")}
                />

                <Tabs value={tab} onValueChange={(v) => setUserTab(v as RfqPageTab)} className="space-y-4">
                  <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
                    <TabsTrigger value="list" className="gap-1.5">
                      {t("tabs.offers")}
                      {world.offers.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums text-muted-foreground">{world.offers.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="compare">{t("tabs.compare")}</TabsTrigger>
                    <TabsTrigger value="inquiries" className="gap-1.5">
                      {t("tabs.inquiries")}
                      {unanswered > 0 && (
                        <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold tabular-nums text-destructive-foreground" title={t("tabs.unanswered_title", { count: unanswered })}>
                          {unanswered}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="list" className="m-0 space-y-4">
                    {noLiveBanner}
                    {world.offers.length === 0 ? (
                      <EmptyState
                        icon={TrendingUp}
                        title={t("list.empty_title")}
                        description={t("list.empty", { date: deadlineText })}
                        action={
                          access.acts && open ? (
                            <span className="flex flex-wrap justify-center gap-2">
                              {canRemind && (
                                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => requestRemind(rfqId)}>
                                  <Bell size={14} aria-hidden="true" />
                                  {t("list.empty_remind")}
                                </Button>
                              )}
                              {!rfq.directAward && (
                                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setShareOpen(true)}>
                                  <Link2 size={14} aria-hidden="true" />
                                  {t("list.empty_link")}
                                </Button>
                              )}
                            </span>
                          ) : undefined
                        }
                      />
                    ) : (
                      <>
                        <RfqBestCards cards={world.cards} showPrices={access.seesPrices} fallbackName={fallbackName} canSplit={access.canDecide && open} onSplit={pickLowest} />
                        <RfqOfferList
                          rows={rows}
                          rfq={rfq}
                          today={today}
                          showPrices={access.seesPrices}
                          canShortlist={access.canShortlist}
                          canAsk={access.acts && open}
                          fallbackName={fallbackName}
                          hasRecord={world.hasRecord}
                          supplierOf={supplierOf}
                          onOpen={setDrawerId}
                          onToggleShortlist={toggleShortlist}
                          onClarify={setClarifyRow}
                        />
                        {open && rfq.deadline && <p className="text-[11px] text-muted-foreground">{t("list.foot", { date: deadlineText })}</p>}
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="compare" className="m-0 space-y-4">
                    {noLiveBanner}
                    {world.offers.length > 0 && <RfqBestCards cards={world.cards} showPrices={access.seesPrices} fallbackName={fallbackName} canSplit={access.canDecide && open} onSplit={pickLowest} />}
                    <RfqCompare world={world} selection={selection} onSelectionHandled={() => setSelection(null)} onAskReval={askRevalOf} lowestRequest={lowestRequest} onLowestHandled={() => setLowestRequest(null)} />
                  </TabsContent>

                  <TabsContent value="inquiries" className="m-0">
                    <RfqInquiriesTab world={world} onExtend={() => requestExtend(rfqId)} />
                  </TabsContent>

                  <TabsContent value="details" className="m-0 space-y-4">
                    <RfqDetailsPanel
                      rfq={rfq}
                      orders={world.orders}
                      notices={world.notices}
                      showPrices={access.seesPrices}
                      onRecordOffer={access.acts && open ? () => setManualOpen(true) : null}
                      onPrint={() => void printDoc()}
                      projectName={projectName}
                    />
                    <RfqTermsPanel rfq={rfq} onExtend={access.acts && open ? () => requestExtend(rfqId) : null} />
                    {!rfq.directAward && <RfqGuestLinkPanel rfqId={rfqId} canShare={access.acts} onShare={() => setShareOpen(true)} phase={linkPhase} viaLink={offPlatform} />}
                    <RfqInvitedList rfq={rfq} offers={world.offers} guestOffers={offPlatform} favoriteIds={[]} />
                    <div id="rfq-requests" className="scroll-mt-4">
                      <RfqRequestsPanel requests={world.requests} />
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </div>

      <RfqOfferDrawer
        row={drawerRow}
        world={world}
        fallbackName={fallbackName}
        onClose={() => setDrawerId(null)}
        actions={{
          onAward: award,
          onToggleShortlist: toggleShortlist,
          onClarify: setClarifyRow,
          onBafo: setBafoRow,
          onReval: setRevalRow,
          onExclude: setExcludeRow,
          onRestore: restore,
          onInvite: (row) => {
            const o = row.offer
            setRegisterGuest({ offerId: row.id, name: row.name, phone: o.guestContact?.phone || null, email: o.guestContact?.email || null, vatNumber: o.guestContact?.vatNumber || null })
          },
          onSample: setSampleRow,
        }}
      />

      {rfqView && <ExcludeDialog row={excludeRow} rfq={rfqView} fallbackName={fallbackName} onOpenChange={(o) => !o && setExcludeRow(null)} onDone={() => (setExcludeRow(null), toast({ title: t("toast.excluded") }))} />}
      <ClarifyDialog
        row={clarifyRow}
        fallbackName={fallbackName}
        onOpenChange={(o) => !o && setClarifyRow(null)}
        onDone={(result, row) => {
          setClarifyRow(null)
          toast({ title: t("toast.clarified"), description: result.guest ? t("toast.guest_whatsapp") : undefined })
          void row
        }}
      />
      <BafoDialog
        row={bafoRow}
        today={today}
        fallbackName={fallbackName}
        onOpenChange={(o) => !o && setBafoRow(null)}
        onDone={(result, row) => {
          setBafoRow(null)
          toast({ title: t("toast.bafo") })
          if (result.guest) reachGuest(row)
        }}
      />
      <RevalDialog
        row={revalRow}
        fallbackName={fallbackName}
        onOpenChange={(o) => !o && setRevalRow(null)}
        onDone={(result) => {
          setRevalRow(null)
          toast({ title: t("toast.reval"), description: result.guest ? t("toast.guest_whatsapp") : undefined })
        }}
      />
      <OfferSampleDialog row={sampleRow} rfq={rfqView} today={today} onClose={() => setSampleRow(null)} />

      {rfqView && (
        <RfqManualOfferDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          rfq={rfqView}
          pendingInvitees={invitedRows(rfqView, world.offers).filter((r) => !r.offered).map((r) => r.orgId)}
          actor={world.runner}
          onDone={() => {
            setManualOpen(false)
            toast({ title: tProc("rfqd.manual.done") })
          }}
        />
      )}
      <GuestNotifyDialog target={guestNotify} onClose={() => setGuestNotify(null)} />
      <LinkComposer rfq={shareOpen && rfq ? { id: rfqId, title: rfq.title || undefined } : null} isOpen={shareOpen} onClose={() => setShareOpen(false)} onPrint={() => void printDoc()} />
      <RfqRegisterGuestDialog guest={registerGuest} rfqId={rfqId} rfqTitle={rfq?.title || ""} orgName={world.orgName || activeCompanyName || ""} actor={world.runner} onOpenChange={(o) => !o && setRegisterGuest(null)} />

      <Dialog open={draftDeleteOpen} onOpenChange={(o) => !deletingDraft && setDraftDeleteOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>{tc("rfq_delete_confirm_title")}</DialogTitle>
            <DialogDescription>{tc("rfq_delete_confirm_desc", { title: rfq?.title || "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDraftDeleteOpen(false)} disabled={deletingDraft}>
              {tc("cancel")}
            </Button>
            <Button onClick={deleteDraft} disabled={deletingDraft} className={cn("gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90")}>
              {deletingDraft && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {tc("rfq_delete_tender")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}
