"use client"

// Product cards — route + BOM + standard time + planned waste + blocking
// facts. The card is data, not code: define one and it travels the system the
// way stone does. The list shows what a card costs and takes at a glance; the
// drawer opens the whole card; managers add new ones.

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Layers, Plus, SearchX } from "lucide-react"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import { MFG_DEPARTMENTS } from "@/lib/manufacturing"
import { standardCost, type MfgProduct } from "@/lib/manufacturing-engine"
import { useMfgUi } from "./MfgUiContext"
import { MfgPrdDrawer } from "./MfgPrdDrawer"
import { MfgPrdForm } from "./MfgPrdForm"
import { MfgPrdFlags, MfgPrdRouteChips, familyIcon, stepName } from "./MfgPrdBits"
import { MfgChip, MfgEmpty, MfgNote, MfgPill, MfgSearchField, fmtMoney, fmtQty } from "./ui/MfgUi"

export function MfgProductsView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const ui = useMfgUi()
  const { perms } = ui
  const router = useRouter()
  const searchParams = useSearchParams()
  const openParam = searchParams?.get("open") || null

  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  // `?open=<productId>` — the module's global search links straight to a card.
  // Each distinct value opens once, so closing the drawer is not undone while
  // the URL still carries the parameter.
  const handledOpen = useRef<string | null>(null)
  useEffect(() => {
    if (!openParam) {
      handledOpen.current = null
      return
    }
    if (handledOpen.current === openParam || !data.productById.has(openParam)) return
    handledOpen.current = openParam
    setDetailId(openParam)
  }, [openParam, data.productById])

  const closeDetail = () => {
    setDetailId(null)
    if (openParam) router.replace(`${ui.base}/products`)
  }

  const products = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data.products
    return data.products.filter((p) =>
      [p.name, p.unit, t(`mfg2_family_${p.family}`), ...(p.route || []).map((r) => stepName(data.departments, r))].join(" ").toLowerCase().includes(q)
    )
  }, [data.products, data.departments, search, t])

  const detail = detailId ? data.productById.get(detailId) || null : null

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-2">
        <MfgPill tone="mfg" icon={Layers} className="text-xs">
          {t("mfg3_prd_count", { count: data.products.length })}
        </MfgPill>
        <MfgSearchField value={search} onChange={setSearch} placeholder={t("mfg2_products_search")} className="w-full sm:w-64" />
        {perms.canManage && (
          <Button size="sm" className="ms-auto h-9 gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus size={14} aria-hidden="true" /> {t("mfg2_new_product")}
          </Button>
        )}
      </div>

      <MfgNote tone="info">{t("mfg3_prd_note")}</MfgNote>

      {data.products.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white">
          <MfgEmpty icon={Layers} title={t("mfg2_products_empty")} hint={perms.canManage ? t("mfg3_prd_empty_hint") : undefined} />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white">
          <MfgEmpty icon={SearchX} title={t("mfg3_search_empty")} />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => setDetailId(p.id)} />
          ))}
        </div>
      )}

      {detail && <MfgPrdDrawer key={detail.id} product={detail} onClose={closeDetail} />}
      {showCreate && (
        <MfgPrdForm
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            setDetailId(id)
          }}
        />
      )}
    </div>
  )
}

function ProductCard({ product, onOpen }: { product: MfgProduct; onOpen: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, perms } = useMfgUi()
  const std = standardCost(product, data.departments, data.settings, 1)
  const buy = product.referenceBuyPrice
  // Make-vs-buy only speaks when both sides are known — an unpriced BOM
  // understates the make cost and would flatter it.
  const makeWins = buy != null && std.allPriced ? std.total <= buy : null
  const Icon = familyIcon(product.family)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-2xl border bg-white p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
          <Icon size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-snug text-foreground" dir="auto">
            {product.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {t(`mfg2_family_${product.family}`)} · {t("mfg3_prd_unit_label", { unit: product.unit })}
          </span>
        </span>
      </span>

      <span className="mt-3 block">
        <MfgPrdRouteChips route={product.route || []} departments={data.departments} />
      </span>
      {(product.requiresMeasurement || product.requiresDrawingApproval || product.requiresSlabApproval || product.wastePercent > 0) && (
        <span className="mt-2 flex flex-wrap gap-1">
          <MfgPrdFlags product={product} />
          {product.wastePercent > 0 && <MfgChip tone="muted">{t("mfg2_waste_label", { percent: fmtQty(product.wastePercent) })}</MfgChip>}
        </span>
      )}

      {(data.settings.features.time || perms.seesMoney) && (
        <span className="block min-h-3 flex-1" aria-hidden="true" />
      )}
      {(data.settings.features.time || perms.seesMoney) && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[11px] font-semibold text-muted-foreground">
          {data.settings.features.time && (
            <span>
              {t("mfg3_prd_card_time")}{" "}
              <b className="tabular-nums text-foreground">
                {fmtQty(std.hours)} {t("mfg2_hours_per_unit")}
              </b>
            </span>
          )}
          {perms.seesMoney && (
            <span>
              {t("mfg2_make_cost")}{" "}
              <b className={cn("tabular-nums", makeWins === true ? "text-success" : makeWins === false ? "text-destructive" : "text-foreground")}>
                {fmtMoney(std.total)} ﷼
              </b>
              {!std.allPriced && <span className="ms-1 text-warning">({t("mfg2_cost_incomplete")})</span>}
            </span>
          )}
          {perms.seesMoney && buy != null && (
            <span>
              {t("mfg2_buy_ref")} <b className="tabular-nums text-foreground">{fmtMoney(buy)} ﷼</b>
            </span>
          )}
          {perms.seesMoney && makeWins != null && (
            <MfgChip tone={makeWins ? "ok" : "bad"} className="ms-auto">
              {makeWins ? t("mfg2_make_wins") : t("mfg2_buy_wins")}
            </MfgChip>
          )}
        </span>
      )}
    </button>
  )
}

/** Departments can be flagged for site installation, given capacity and a
 * checklist template from the Settings tab; this small helper is shared there. */
export async function updateDepartmentCapacity(
  firestore: ReturnType<typeof useFirestore>,
  departmentId: string,
  patch: {
    workers?: number | null
    hoursPerDay?: number | null
    hourlyRate?: number | null
    onSite?: boolean
    checklist?: Array<{ key: string; label: string }>
  }
): Promise<void> {
  if (!firestore) return
  await updateDoc(doc(firestore, MFG_DEPARTMENTS, departmentId), { ...patch, updatedAt: serverTimestamp() })
}
