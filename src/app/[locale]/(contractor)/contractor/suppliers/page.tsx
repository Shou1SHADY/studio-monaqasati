"use client"

// Procurement › Suppliers (PRD 3.0 §7.2, prototype vSup). Four segments: our
// suppliers (with the invitations we sent), the platform directory, and — for
// those who see prices only — the price agreements and the price history.
// The manager and the buyer manage the file (add, invite, favour); the
// expediter reads; so does the owner of a company with a procurement team. A
// buyer's list is his categories' material suppliers plus every service
// company and subcontractor (the prototype's `supScope`).
// `?segment=` opens one directly (the Today queue links to the agreements) and
// is refused silently for a price segment the viewer may not see; `?supplier=`,
// `?agreement=` and `?material=` open a drawer, so a notification or a Today
// row can land on the record itself.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { addDoc, arrayRemove, arrayUnion, collection, doc, query, serverTimestamp, updateDoc, where } from "firebase/firestore"
import { Briefcase, Loader2, Search, Send, UserPlus, X } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { useSupplierDirectory, type PlatformSupplier } from "@/hooks/useSupplierDirectory"
import { matchesSearch } from "@/lib/search-text"
import { CATEGORIES_DATA, displayCategory } from "@/lib/constants"
import { MFG_PRODUCTS } from "@/lib/manufacturing-engine"
import { poStatus, supplierScore, todayOf } from "@/lib/procurement/po"
import {
  OPEN_WITH_SUPPLIER,
  SUPPLIER_RECORDS,
  canManageSuppliers,
  favouriteLogEntry,
  filterDirectory,
  type OriginFilter,
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
import { SupplierFileDrawer } from "@/components/procurement/SupplierFileDrawer"
import { DirectoryDrawer } from "@/components/procurement/DirectoryDrawer"
import { SupplierInvitations, type InvitationDoc } from "@/components/procurement/SupplierInvitations"
import { InviteSupplierDialog } from "@/components/procurement/InviteSupplierDialog"
import { PriceAgreementsView } from "@/components/procurement/PriceAgreementsView"
import { PriceHistoryView } from "@/components/procurement/PriceHistoryView"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { useInventoryCatalog } from "@/hooks/useInventoryCatalog"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

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
  const { suppliers, loading } = useSupplierDirectory(orgId, favoriteIds, offers)

  const invitationsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "invitations"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: invitationDocs } = useCollection<Omit<InvitationDoc, "id">>(invitationsQ)
  const invitations = useMemo(() => ((invitationDocs || []) as InvitationDoc[]).filter((i) => i.type === "supplier_invite"), [invitationDocs])
  const pendingInvitations = invitations.filter((i) => i.status === "pending").length

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

  const [searchQuery, setSearchQuery] = useState("")
  const [originFilter, setOriginFilter] = useState<OriginFilter>("")
  const [showInvite, setShowInvite] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PlatformSupplier | null>(null)
  const [removing, setRemoving] = useState(false)

  const mineRows = useMemo<SupplierRow[]>(() => {
    const rows = suppliers
      .filter((s) => s.isMine && supplierInScope(s, team.viewerCategories, CATEGORIES_DATA))
      .map((s) => {
        const list = ordersOfSupplier(orders, s.orgId)
        return {
          ...s,
          score: supplierScore(list, deliveries, now, rfqInviteFacts(s.orgId, s.memberIds, rfqs, offers)),
          open: list.filter((o) => OPEN_WITH_SUPPLIER.has(poStatus(o))).length,
        }
      })
    return [...rows.filter((r) => r.isFavorite), ...rows.filter((r) => !r.isFavorite)]
  }, [suppliers, orders, deliveries, rfqs, offers, now, team.viewerCategories])
  const shownMine = mineRows.filter(
    (s) =>
      (!originFilter || (originFilter === "international") === s.international) &&
      matchesSearch(searchQuery, [s.name, s.city, ...s.categories, ...s.categories.map((c) => displayCategory(c, locale))])
  )
  // One search box across the four segments (S-45): the query stays when the segment changes.
  const shownPlatform = useMemo(() => filterDirectory(suppliers, { q: searchQuery, category: "", city: "", origin: originFilter }, (c) => displayCategory(c, locale)), [suppliers, searchQuery, originFilter, locale])
  const shownAgreements = useMemo(
    () => agreements.filter((a) => matchesSearch(searchQuery, [a.docNumber, displayAgreementNumber(a.docNumber, locale), a.supplierName, ...(a.lines || []).map((l) => l.name)])),
    [agreements, searchQuery, locale]
  )
  const catalog = useInventoryCatalog(orgId, actor.seesPrices && segment === "history")

  const fileSupplier = suppliers.find((s) => s.orgId === fileId) || null
  const fileRow = mineRows.find((s) => s.orgId === fileId) || null
  const fileInvited = fileSupplier ? rfqInviteFacts(fileSupplier.orgId, fileSupplier.memberIds, rfqs, offers).invited : 0
  const dirSupplier = suppliers.find((s) => s.orgId === dirId) || null

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
  const counts: Record<SupplierTabSegment, number | undefined> = { mine: mineRows.length, platform: suppliers.length, agreements: agreements.length, history: undefined }
  const spinner = (
    <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
      <Loader2 className="mb-4 animate-spin" size={32} aria-hidden="true" />
      <p>{t("loading")}</p>
    </div>
  )

  return (
    <PortalLayout>
      <div className="space-y-6">
        <ProcurementHeader
          title={t("page.title")}
          description={t("page.subtitle")}
          action={
            canManage && (
              <Button className="gap-2 bg-module text-module-foreground hover:bg-module/90" onClick={() => setShowInvite(true)}>
                <Send size={16} className="rtl-flip" aria-hidden="true" />
                {tC("suppliers_invite_platform")}
                {pendingInvitations > 0 && <span className="rounded-full bg-warning px-1.5 text-[10px] font-bold text-white">{pendingInvitations}</span>}
              </Button>
            )
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <ProcChipGroup items={segments.map((s) => ({ id: s, label: t(`seg.${s}`), count: counts[s] }))} active={segment} onPick={pickSegment} label={tC("suppliers_scope_label")} />
          <NativeSelect
            aria-label={t("origin.label")}
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
            className="ms-auto h-10 rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t("origin.all")}</option>
            <option value="local">{t("origin.local")}</option>
            <option value="international">{t("origin.international")}</option>
          </NativeSelect>
          <div className="relative w-full sm:w-72">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input placeholder={t("p2c.search_all")} aria-label={t("p2c.search_all")} className="pe-8 ps-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} dir="auto" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label={tC("suppliers_search_clear")}
                className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {segment === "agreements" ? (
          !pricesReady ? (
            spinner
          ) : (
            <PriceAgreementsView
              agreements={shownAgreements}
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
          <SupplierDirectory suppliers={shownPlatform} onOpen={setDirId} />
        ) : (
          <div className="space-y-4">
            <SupplierInvitations invitations={invitations} canManage={canManage} orgName={orgName} now={now} />
            {shownMine.length === 0 ? (
              searchQuery ? (
                <EmptyState icon={Search} title={tC("suppliers_no_search_results")} description={tC("suppliers_no_search_results_desc")} />
              ) : (
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
              )
            ) : (
              <OurSuppliersTable rows={shownMine} today={today} onOpen={openFile} />
            )}
          </div>
        )}
      </div>

      <SupplierFileDrawer
        supplier={fileSupplier}
        open={Boolean(fileSupplier)}
        onOpenChange={(o) => !o && openFile(null)}
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
      <InviteSupplierDialog open={showInvite} onOpenChange={setShowInvite} orgName={orgName} />

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
    </PortalLayout>
  )
}
