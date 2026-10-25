"use client"

// Procurement › Suppliers (PRD 2.0 SUP-01..06, prototype vSup). Five segments: our
// suppliers, the invitations we sent, the platform directory, and — for those who
// see prices only — the price agreements and the price history. «مورّدونا» and the
// directory are ONE list with one filter bar (SupplierList); the directory is read
// a page at a time from the server and never loaded whole into the browser.
// The manager and the buyer manage the file (add, invite, favour); the
// expediter reads; so does the owner of a company with a procurement team. A
// buyer's list is his categories' material suppliers plus every service
// company and subcontractor (the prototype's `supScope`).
// `?segment=` opens one directly (the Today queue links to the agreements) and
// is refused silently for a price segment the viewer may not see; `?supplier=`,
// `?agreement=` and `?material=` open a drawer, so a notification or a Today
// row can land on the record itself.

import { useCallback, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { addDoc, arrayRemove, arrayUnion, collection, doc, query, serverTimestamp, updateDoc, where } from "firebase/firestore"
import { Briefcase, Loader2, Send, UserPlus } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useToast } from "@/hooks/use-toast"
import { useProcTeam } from "@/hooks/useProcTeam"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useOurSuppliers, usePlatformCards, usePlatformDirectoryTotal, usePlatformSupplier, type PlatformSupplier } from "@/hooks/useSupplierDirectory"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { categoryTree, treeScope, treeSupplier } from "@/lib/materials/category-tree"
import { keyLabel, specialtyKeys } from "@/lib/materials/subs"
import { displayCategory } from "@/lib/constants"
import { MFG_PRODUCTS } from "@/lib/manufacturing-engine"
import { poStatus, supplierScore, todayOf } from "@/lib/procurement/po"
import {
  OPEN_WITH_SUPPLIER,
  SUPPLIER_RECORDS,
  canManageSuppliers,
  favouriteLogEntry,
  isOffPlatform,
  canRenewAgreements,
  canSignAgreements,
  makeOrBuyKeys,
  ordersOfSupplier,
  rfqInviteFacts,
  segmentFromParam,
  supplierInScope,
  visibleSupplierSegments,
  type SupplierTabSegment,
} from "@/lib/procurement/supplier-file"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { OurSuppliersTable, type SupplierRow } from "@/components/procurement/OurSuppliersTable"
import { SupplierDirectory } from "@/components/procurement/SupplierDirectory"
import type { SupplierLayout } from "@/components/procurement/SupplierList"
import { EMPTY_SUPPLIER_FILTER, type SupplierFilter } from "@/lib/procurement/supplier-list"
import { SupplierFileDrawer } from "@/components/procurement/SupplierFileDrawer"
import { DirectoryDrawer } from "@/components/procurement/DirectoryDrawer"
import { SupplierLinkContext } from "@/components/procurement/SupplierLink"
import { SupplierInvitations, type InvitationDoc } from "@/components/procurement/SupplierInvitations"
import { SupplierConnectionRequests } from "@/components/procurement/SupplierConnectionRequests"
import { InviteSupplierDialog, type InvitePrefill } from "@/components/procurement/InviteSupplierDialog"
import { PriceAgreementsView } from "@/components/procurement/PriceAgreementsView"
import { PriceHistoryView } from "@/components/procurement/PriceHistoryView"
import type { GuestOfferFact } from "@/lib/procurement/supplier-offplatform"
import type { PriceOfferLike, PriceRfqLike } from "@/lib/procurement/prices"
import { useInventoryCatalog } from "@/hooks/useInventoryCatalog"
import { supplierInvitationsQuery } from "@/lib/procurement/invite-query"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    typeof val === "object" && val !== null && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric" })
}

/** Keeps the drawer params in the address bar without a navigation. */
function replaceParams(update: (params: URLSearchParams) => void) {
  try {
    const url = new URL(window.location.href)
    update(url.searchParams)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* not in a browser */
  }
}

export default function SuppliersPage() {
  const t = useTranslations("Portal.ProcSuppliers")
  const tC = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const [now] = useState(() => new Date())
  const today = todayOf(now)
  const { user } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()
  const searchParams = useSearchParams()

  const world = useProcurementWorld()
  const { orders, deliveries, rfqs, offers, actor, orgId, orgName } = world
  const team = useProcTeam(orgId, actor)
  const ownerHasTeam = team.ownerHasTeam
  const canManage = canManageSuppliers(actor, ownerHasTeam)
  const { agreements, history, ready: pricesReady } = useProcurementPrices(orgId)
  const mayEditAgreements = canSignAgreements(actor, ownerHasTeam)
  const mayRenewAgreements = canRenewAgreements(actor, ownerHasTeam)

  const userDocRef = useMemoFirebase(() => (firestore && user ? doc(firestore, "users", user.uid) : null), [firestore, user])
  const { data: profile } = useDoc<{ favoriteSuppliers?: string[] }>(userDocRef)
  const favoriteIds = useMemo(() => profile?.favoriteSuppliers || [], [profile?.favoriteSuppliers])
  const { suppliers, loading } = useOurSuppliers(orgId, favoriteIds, offers)
  const { index: treeIndex } = useMaterialTree()

  const invitationsQ = useMemoFirebase(() => (firestore && orgId ? supplierInvitationsQuery(firestore, orgId) : null), [firestore, orgId])
  const { data: invitationDocs } = useCollection<Omit<InvitationDoc, "id">>(invitationsQ)
  const invitations = useMemo(() => ((invitationDocs || []) as InvitationDoc[]).filter((i) => i.type === "supplier_invite"), [invitationDocs])
  const pendingInvitations = invitations.filter((i) => i.status === "pending").length
  const [invitePrefill, setInvitePrefill] = useState<InvitePrefill | null>(null)

  const mfgOn = useModules().on("manufacturing")
  const productsQ = useMemoFirebase(() => (firestore && orgId && actor.seesPrices && mfgOn ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, actor.seesPrices, mfgOn])
  const { data: productDocs } = useCollection<{ name?: string }>(productsQ)
  const makeOrBuy = useMemo(() => makeOrBuyKeys((productDocs || []).map((p) => p.name)), [productDocs])

  const [asked, setAsked] = useState<string | null>(() => searchParams?.get("segment") || null)
  const segment = segmentFromParam(asked, actor.seesPrices)
  const pickSegment = (s: SupplierTabSegment) => {
    setAsked(s)
    replaceParams((p) => (s === "mine" ? p.delete("segment") : p.set("segment", s)))
  }

  const [fileId, setFileId] = useState<string | null>(() => searchParams?.get("supplier") || null)
  const [dirId, setDirId] = useState<string | null>(null)
  const [agreementId, setAgreementId] = useState<string | null>(() => searchParams?.get("agreement") || null)
  const [materialKeyParam, setMaterialKeyParam] = useState<string | null>(() => searchParams?.get("material") || null)
  const openFile = (id: string | null) => {
    setFileId(id)
    replaceParams((p) => (id ? p.set("supplier", id) : p.delete("supplier")))
  }
  const openAgreement = (id: string | null) => {
    setAgreementId(id)
    if (id) {
      setFileId(null)
      setAsked("agreements")
    }
    replaceParams((p) => {
      p.delete("supplier")
      if (id) {
        p.set("segment", "agreements")
        p.set("agreement", id)
      } else p.delete("agreement")
    })
  }

  // The page's one search is the header's (review 2 #1): every segment reads `?search=` live — our suppliers, the
  // directory, the agreements and the price history — and a list clearing its filters clears it.
  const searchQuery = searchParams?.get("search") ?? ""
  const setSearchQuery = useCallback((q: string) => replaceParams((p) => (q.trim() ? p.set("search", q) : p.delete("search"))), [])
  const [oursFilter, setOursFilterOwn] = useState<SupplierFilter>(EMPTY_SUPPLIER_FILTER)
  const [dirFilter, setDirFilterOwn] = useState<SupplierFilter>(EMPTY_SUPPLIER_FILTER)
  const withSearch = useCallback(
    (set: (f: SupplierFilter) => void) => (next: SupplierFilter) => {
      set({ ...next, q: "" })
      if (next.q !== searchQuery) setSearchQuery(next.q)
    },
    [searchQuery, setSearchQuery]
  )
  const oursShown = useMemo(() => ({ ...oursFilter, q: searchQuery }), [oursFilter, searchQuery])
  const dirShown = useMemo(() => ({ ...dirFilter, q: searchQuery }), [dirFilter, searchQuery])
  const [oursLayout, setOursLayout] = useState<SupplierLayout>("rows")
  const [dirLayout, setDirLayout] = useState<SupplierLayout>("cards")
  const [dirTotal, setDirTotal] = useState<number | undefined>(undefined)
  // The segment shows its count before it is opened, like the other four (the prototype's «دليل موردي المنصة 20»).
  const dirTotalAhead = usePlatformDirectoryTotal(dirTotal === undefined && segment !== "platform")
  const [showInvite, setShowInvite] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PlatformSupplier | null>(null)
  const [removing, setRemoving] = useState(false)

  const mineRows = useMemo<SupplierRow[]>(() => {
    const scope = treeScope(treeIndex, team.viewerCategories)
    const rows = suppliers
      .filter((s) => s.isMine && (isOffPlatform(s) || supplierInScope(treeSupplier(s, treeIndex), scope, categoryTree(treeIndex))))
      .map((s) => {
        const list = ordersOfSupplier(orders, s.orgId)
        return {
          ...s,
          score: supplierScore(list, deliveries, now, rfqInviteFacts(s.orgId, s.memberIds, rfqs, offers)),
          open: list.filter((o) => OPEN_WITH_SUPPLIER.has(poStatus(o))).length,
        }
      })
    return [...rows.filter((r) => r.isFavorite), ...rows.filter((r) => !r.isFavorite)]
  }, [suppliers, orders, deliveries, rfqs, offers, now, team.viewerCategories, treeIndex])
  const mineIds = useMemo(() => new Set(suppliers.map((s) => s.orgId)), [suppliers])
  const specialtyLabel = useCallback((key: string) => keyLabel(treeIndex, key, locale, displayCategory), [treeIndex, locale])
  const specialtiesOf = useCallback((s: SupplierRow) => specialtyKeys(treeIndex, s.subIds, s.categories), [treeIndex])
  const platformCards = usePlatformCards(
    useMemo(() => [...mineRows.map((s) => s.orgId), fileId || "", dirId || ""].filter(Boolean), [mineRows, fileId, dirId]),
    segment === "mine" || Boolean(fileId) || Boolean(dirId)
  )
  const catalog = useInventoryCatalog(orgId, actor.seesPrices && segment === "history")

  const fetchedFile = usePlatformSupplier(fileId && !mineIds.has(fileId) ? fileId : null, favoriteIds)
  const fileSupplier = suppliers.find((s) => s.orgId === fileId) || fetchedFile
  const fileRow = mineRows.find((s) => s.orgId === fileId) || null
  const fileInvited = fileSupplier ? rfqInviteFacts(fileSupplier.orgId, fileSupplier.memberIds, rfqs, offers).invited : 0
  const fetchedDir = usePlatformSupplier(dirId && !mineIds.has(dirId) ? dirId : null, favoriteIds)
  const dirSupplier = suppliers.find((s) => s.orgId === dirId) || fetchedDir

  const toggleFavorite = async (supplier: PlatformSupplier) => {
    if (!userDocRef || !firestore || !orgId) return
    const isExplicit = supplier.isExplicitFavorite
    const stored = [supplier.orgId, ...supplier.memberIds].filter((id) => favoriteIds.includes(id))
    try {
      // Marking a not-yet-connected supplier as favourite connects him at once —
      // favouriting is "I already work with them".
      if (!isExplicit && !supplier.linkId) {
        await addDoc(collection(firestore, "contractorSupplierLinks"), {
          contractorOrgId: orgId,
          supplierOrgId: supplier.orgId,
          supplierName: supplier.name,
          supplierCategories: supplier.categories,
          status: "active",
          requestedBy: "contractor_favorite",
          requestedAt: serverTimestamp(),
          connectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      await updateDoc(userDocRef, { favoriteSuppliers: isExplicit ? arrayRemove(...stored) : arrayUnion(supplier.orgId) })
      // The supplier file's log says who favoured him and when (S-35). Best-effort:
      // the rules let only a manager write the record, so a buyer's toggle is not logged yet.
      if (supplier.record?.id) {
        void updateDoc(doc(firestore, SUPPLIER_RECORDS, supplier.record.id), { log: arrayUnion(favouriteLogEntry(actor, !isExplicit, new Date().toISOString())) }).catch((err) =>
          console.warn("favourite not logged:", (err as { code?: string })?.code || err)
        )
      }
      toast({
        title: isExplicit ? tC("suppliers_fav_removed") : tC("suppliers_fav_added"),
        description: isExplicit ? tC("suppliers_fav_removed_desc") : supplier.linkId ? tC("suppliers_fav_added_desc") : tC("suppliers_fav_added_connected_desc"),
      })
    } catch {
      toast({ title: tC("generic_error_title"), description: tC("suppliers_fav_error"), variant: "destructive" })
    }
  }

  const removeConnection = async () => {
    if (!firestore || !removeTarget?.linkId) return
    setRemoving(true)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", removeTarget.linkId), { status: "rejected" })
      toast({ title: tC("my_sup_toast_removed") })
      openFile(null)
    } catch {
      toast({ title: tC("generic_error_title"), variant: "destructive" })
    } finally {
      setRemoving(false)
      setRemoveTarget(null)
    }
  }

  const segments = visibleSupplierSegments(actor.seesPrices)
  const counts: Record<SupplierTabSegment, number | undefined> = { mine: mineRows.length, invitations: invitations.length, platform: dirTotal ?? dirTotalAhead, agreements: agreements.length, history: undefined }
  const spinner = (
    <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
      <Loader2 className="mb-4 animate-spin" size={32} aria-hidden="true" />
      <p>{t("loading")}</p>
    </div>
  )

  // SP-03: a supplier's name in the agreements and the price history opens his file on this page — ours, or the directory's profile.
  const openSupplierLink = (id: string) => (mineIds.has(id) ? openFile(id) : setDirId(id))

  return (
    <PortalLayout>
      <SupplierLinkContext.Provider value={openSupplierLink}>
      <div className="space-y-6">
        <ProcurementHeader
          title={t("page.title")}
          description={t("page.subtitle")}
          action={
            canManage && (
              <Button variant="module" className="gap-2 rounded-xl" onClick={() => setShowInvite(true)}>
                <Send size={16} className="rtl-flip" aria-hidden="true" />
                {tC("suppliers_invite_platform")}
                {pendingInvitations > 0 && <span className="rounded-full bg-warning px-1.5 text-[10px] font-bold text-white">{pendingInvitations}</span>}
              </Button>
            )
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <ProcChipGroup items={segments.map((s) => ({ id: s, label: t(`seg.${s}`), count: counts[s] }))} active={segment} onPick={pickSegment} label={tC("suppliers_scope_label")} />
        </div>

        {segment === "agreements" ? (
          !pricesReady ? (
            spinner
          ) : (
            <PriceAgreementsView
              agreements={agreements}
              query={searchQuery}
              history={history}
              orders={orders}
              actor={actor}
              orgId={orgId}
              locale={locale}
              suppliers={mineRows.map((s) => ({ id: s.orgId, name: s.name }))}
              mayEdit={mayEditAgreements}
              mayRenew={mayRenewAgreements}
              ownerHasTeam={ownerHasTeam}
              fmtDate={fmtDate}
              focusId={agreementId}
              onFocusChange={(id) => openAgreement(id)}
            />
          )
        ) : segment === "history" ? (
          !pricesReady ? (
            spinner
          ) : (
            <PriceHistoryView
              query={searchQuery}
              itemOf={catalog.itemOf}
              history={history}
              orders={orders}
              receipts={deliveries}
              agreements={agreements}
              offers={offers as unknown as PriceOfferLike[]}
              rfqs={rfqs as unknown as PriceRfqLike[]}
              makeOrBuy={makeOrBuy}
              locale={locale}
              fmtDate={fmtDate}
              focusKey={materialKeyParam}
              onFocusChange={(key) => {
                setMaterialKeyParam(key)
                replaceParams((p) => (key ? p.set("material", key) : p.delete("material")))
              }}
            />
          )
        ) : loading ? (
          spinner
        ) : segment === "platform" ? (
          <SupplierDirectory
            filter={dirShown}
            onFilter={withSearch(setDirFilterOwn)}
            searchless
            layout={dirLayout}
            onLayout={setDirLayout}
            specialtyLabel={specialtyLabel}
            mineIds={mineIds}
            onOpen={setDirId}
            onAdd={canManage ? setDirId : undefined}
            onTotal={setDirTotal}
          />
        ) : segment === "invitations" ? (
          <SupplierInvitations
            invitations={invitations}
            canManage={canManage}
            now={now}
            onResend={(p) => {
              setInvitePrefill(p)
              setShowInvite(true)
            }}
            onOpenSupplier={(id) => {
              pickSegment("mine")
              openFile(id)
            }}
          />
        ) : (
          <div className="space-y-4">
            <SupplierConnectionRequests orgId={orgId} orgName={orgName} actor={actor} canManage={canManage} />
            <OurSuppliersTable
              rows={mineRows}
              cards={platformCards}
              today={today}
              filter={oursShown}
              onFilter={withSearch(setOursFilterOwn)}
              searchless
              layout={oursLayout}
              onLayout={setOursLayout}
              specialtiesOf={specialtiesOf}
              specialtyLabel={specialtyLabel}
              onOpen={openFile}
              emptyAll={
                <EmptyState
                  icon={Briefcase}
                  title={tC("suppliers_no_suppliers")}
                  description={t("page.empty_desc")}
                  action={
                    canManage && (
                      <Button variant="outline" className="gap-2" onClick={() => setShowInvite(true)}>
                        <UserPlus size={16} aria-hidden="true" />
                        {tC("suppliers_invite_platform")}
                      </Button>
                    )
                  }
                />
              }
            />
            <p className="text-xs text-muted-foreground">{t("list.ours_caption")}</p>
          </div>
        )}
      </div>

      <SupplierFileDrawer
        supplier={fileSupplier}
        open={Boolean(fileSupplier)}
        onOpenChange={(o) => !o && openFile(null)}
        notices={deliveries}
        card={fileSupplier ? platformCards.get(fileSupplier.orgId) : null}
        offers={offers as unknown as GuestOfferFact[]}
        onInvite={(p) => {
          setInvitePrefill(p)
          setShowInvite(true)
        }}
        score={fileRow?.score || null}
        invited={fileInvited}
        orders={orders}
        agreements={agreements}
        actor={actor}
        orgId={orgId}
        canManage={canManage}
        ownerHasTeam={ownerHasTeam}
        now={now}
        onToggleFavorite={toggleFavorite}
        onRemove={setRemoveTarget}
        onOpenAgreement={openAgreement}
      />
      <DirectoryDrawer
        card={dirSupplier ? platformCards.get(dirSupplier.orgId) : null}
        supplier={dirSupplier}
        open={Boolean(dirSupplier)}
        onOpenChange={(o) => !o && setDirId(null)}
        actor={actor}
        orgId={orgId}
        canManage={canManage}
        ownerHasTeam={ownerHasTeam}
        onOpenOurs={(id) => {
          setDirId(null)
          pickSegment("mine")
          openFile(id)
        }}
      />
      <InviteSupplierDialog
        open={showInvite}
        onOpenChange={(o) => {
          setShowInvite(o)
          if (!o) setInvitePrefill(null)
        }}
        orgName={orgName}
        prefill={invitePrefill}
        invitations={invitations}
        platform={suppliers.filter((s) => !isOffPlatform(s)).map((s) => ({ orgId: s.orgId, name: s.name, phone: s.phone, email: s.email }))}
        onAddExisting={(id) => setDirId(id)}
      />

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tC("my_sup_remove_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{tC("my_sup_remove_confirm_desc", { supplier: removeTarget?.name || "—" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tC("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" disabled={removing} onClick={removeConnection}>
              {removing && <Loader2 className="animate-spin" size={14} aria-hidden="true" />}
              {tC("my_sup_remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </SupplierLinkContext.Provider>
    </PortalLayout>
  )
}
