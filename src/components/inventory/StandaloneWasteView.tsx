"use client"

/**
 * Waste outside a project.
 *
 * A supplier cuts marble slabs into a table and is left with offcuts; a
 * contractor's yard breaks a pallet of blocks that was never issued to a site.
 * Neither has a project to hang the record on, and until now the only way to
 * record waste was from inside one. This page records it straight from a
 * warehouse. Contractors may still attach a project — then the record lands
 * in that project's ledger and can be linked to a BOQ line; suppliers have no
 * projects, so the field does not exist for them.
 */

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, getDocs, query, where } from "firebase/firestore"
import { Plus, Scissors, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Link } from "@/i18n/routing"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import type { WasteScope } from "@/hooks/useProjectWasteStats"
import { DEFAULT_WASTE_TARGET_PERCENT, recordWasteConsumption } from "@/lib/waste-writes"
import { WasteLedger } from "@/components/contractor/WasteLedger"
import { WasteRecordDialog, type WasteInventoryItem } from "@/components/inventory/WasteRecordDialog"

const NO_PROJECT = "__none__"

type WarehouseDoc = { id: string; name: string; location?: string }
type ProjectDoc = { id: string; name: string; warehouseId?: string | null; wasteTargetPercent?: number | null }
type BoqLine = { id: string; descriptionAr: string; descriptionEn: string }

export function StandaloneWasteView({ portal }: { portal: "contractor" | "supplier" }) {
  // The waste vocabulary lives with the projects module; both portals reuse it.
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("warehouses.manage")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: warehousesData, isLoading: warehousesLoading } = useCollection(warehousesQuery)
  const warehouses = useMemo(() => (warehousesData || []) as WarehouseDoc[], [warehousesData])

  // Only the contractor has projects to offer.
  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || portal !== "contractor") return null
    return query(collection(firestore, "projects"), where("organizationId", "==", orgId))
  }, [firestore, orgId, portal])
  const { data: projectsData } = useCollection(projectsQuery)
  const projects = useMemo(() => (projectsData || []) as ProjectDoc[], [projectsData])

  const [warehouseId, setWarehouseId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [boqLines, setBoqLines] = useState<BoqLine[]>([])
  const [showDialog, setShowDialog] = useState(false)

  // Default to the first warehouse once they load, and never point at one
  // that has since been deleted.
  useEffect(() => {
    if (warehouses.length === 0) { setWarehouseId(""); return }
    if (!warehouses.some((w) => w.id === warehouseId)) setWarehouseId(warehouses[0].id)
  }, [warehouses, warehouseId])

  const project = projects.find((p) => p.id === projectId) ?? null

  // Picking a project pulls its BOQ so a row can be attributed to a line —
  // the one thing a project adds to a waste entry.
  useEffect(() => {
    let cancelled = false
    if (!firestore || !projectId) { setBoqLines([]); return }
    getDocs(collection(firestore, "projects", projectId, "boqItems"))
      .then((snap) => {
        if (cancelled) return
        setBoqLines(
          snap.docs.map((d) => {
            const data = d.data() as { descriptionAr?: string; descriptionEn?: string; description?: string }
            return {
              id: d.id,
              descriptionAr: data.descriptionAr || data.description || "",
              descriptionEn: data.descriptionEn || "",
            }
          })
        )
      })
      .catch(() => { if (!cancelled) setBoqLines([]) })
    return () => { cancelled = true }
  }, [firestore, projectId])

  const inventoryQuery = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return collection(firestore, "warehouses", warehouseId, "inventoryItems")
  }, [firestore, warehouseId])
  const { data: inventoryData } = useCollection(inventoryQuery)
  const inventoryItems = useMemo(() => (inventoryData || []) as WasteInventoryItem[], [inventoryData])

  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null
  const scope: WasteScope | null = projectId
    ? { projectId }
    : warehouseId
      ? { warehouseId }
      : null
  const wasteTargetPercent = project?.wasteTargetPercent ?? DEFAULT_WASTE_TARGET_PERCENT

  const base = portal === "contractor" ? "/contractor" : "/supplier"

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Scissors size={22} className="shrink-0" aria-hidden="true" />
            {t("waste_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t(portal === "supplier" ? "waste_page_desc_supplier" : "waste_page_desc_contractor")}
          </p>
        </div>
        {canManage && warehouse && (
          <Button className="gap-2 shrink-0" onClick={() => setShowDialog(true)} disabled={inventoryItems.length === 0}>
            <Plus size={16} />
            {t("waste_record_btn")}
          </Button>
        )}
      </header>

      {!warehousesLoading && warehouses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <Warehouse size={28} className="mx-auto text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{t("waste_no_warehouses_title")}</p>
          <p className="text-xs text-muted-foreground">{t("waste_no_warehouses_desc")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/warehouses`}>{t("wh_page_title")}</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Source first, project second. The project is optional and only
              exists on the contractor side; the warehouse is what the stock
              actually leaves. */}
          <div className={cn("grid gap-4", portal === "contractor" ? "sm:grid-cols-2" : "sm:grid-cols-1 sm:max-w-md")}>
            <div className="space-y-1.5">
              <Label htmlFor="waste-warehouse">{t("waste_pick_warehouse")}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger id="waste-warehouse"><SelectValue placeholder={t("waste_pick_warehouse")} /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.location ? ` — ${w.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {portal === "contractor" && (
              <div className="space-y-1.5">
                <Label htmlFor="waste-project">{t("waste_pick_project")}</Label>
                <Select value={projectId || NO_PROJECT} onValueChange={(v) => setProjectId(v === NO_PROJECT ? "" : v)}>
                  <SelectTrigger id="waste-project"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT}>{t("waste_no_project")}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {projectId ? t("waste_project_hint_linked") : t("waste_project_hint_none")}
                </p>
              </div>
            )}
          </div>

          {warehouse && inventoryItems.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">{t("waste_no_items_title")}</p>
              <p className="text-xs text-muted-foreground">{t("waste_no_items_desc")}</p>
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/warehouses/${warehouse.id}`}>{warehouse.name}</Link>
              </Button>
            </div>
          )}

          {scope && (
            <WasteLedgerOrEmpty
              scope={scope}
              name={project?.name || warehouse?.name || ""}
              wasteTargetPercent={wasteTargetPercent}
              canManage={canManage}
              t={t}
              locale={locale}
            />
          )}
        </>
      )}

      {warehouse && (
        <WasteRecordDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          warehouseId={warehouse.id}
          inventoryItems={inventoryItems}
          boqItems={projectId ? boqLines : []}
          wasteTargetPercent={wasteTargetPercent}
          title={t("waste_dialog_title", { warehouse: warehouse.name })}
          description={t(projectId ? "waste_dialog_desc_project" : "waste_dialog_desc_standalone")}
          locale={locale}
          t={t}
          onConsume={async (rows, exceptionReason) => {
            if (!firestore || !user || !scope) return
            const userName = (profile as { name?: string } | null)?.name || user.email || t("proj_team_member_fallback")
            await recordWasteConsumption(firestore, {
              rows,
              warehouseId: warehouse.id,
              scope,
              projectName: project?.name ?? null,
              exceptionReason: exceptionReason ?? null,
              wasteTargetPercent,
              userId: user.uid,
              userName,
            })
            toast({ title: t("waste_recorded_toast") })
          }}
        />
      )}
    </div>
  )
}

/** The ledger hides itself when empty; this shows why the page looks bare. */
function WasteLedgerOrEmpty({
  scope,
  name,
  wasteTargetPercent,
  canManage,
  t,
  locale,
}: {
  scope: WasteScope
  name: string
  wasteTargetPercent: number
  canManage: boolean
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-foreground">{t("ledger_title")} — {name}</h2>
      <WasteLedger
        scope={scope}
        projectName={name}
        wasteTargetPercent={wasteTargetPercent}
        canManage={canManage}
        t={t}
        locale={locale}
      />
      <p className="text-[11px] text-muted-foreground">{t("waste_ledger_hint")}</p>
    </div>
  )
}
