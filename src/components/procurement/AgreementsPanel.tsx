"use client"

// «اتفاقيات الأسعار» as a table (SUP-06, prototype vSup:agr): the agreement and its supplier · the material and the agreed
// price (EXCLUDING VAT) · the days it holds · how much of its CAP the orders that name it have used · whether it is in force.
// The cap and the consumed amount are read, never typed here: consumed is the sum of the live orders that name the agreement
// (`agreementConsumption`). An agreement states a cap per line, or states none and says so — it is never given one.
// Ordering from an agreement is not extended by this table (open decision 13).

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Handshake } from "lucide-react"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { agreementConsumption, type AgreementState, type PriceAgreement } from "@/lib/procurement/prices"
import { agreementOrderCounts } from "@/lib/procurement/supplier-file"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"
import { sarLtr } from "@/lib/riyal"

export type AgreementRow = PriceAgreement & { state: AgreementState; daysLeft: number }

const TONE: Record<AgreementState, PillTone> = { live: "ok", expiring: "warn", upcoming: "mute", expired: "bad" }
const priceText = (n: number) => sarLtr(Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const plain = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function AgreementsPanel({ rows, orders, fmtDate, onOpen, empty }: { rows: AgreementRow[]; orders: PurchaseOrder[]; fmtDate: (value: unknown, locale: string) => string; onOpen: (id: string) => void; empty?: React.ReactNode }) {
  const t = useTranslations("Portal.ProcPrices")
  const a2 = useTranslations("Portal.ProcPrices.agr2")
  const locale = useLocale()
  const counts = useMemo(() => agreementOrderCounts(orders), [orders])
  const consumption = useMemo(() => new Map(rows.map((a) => [a.id, agreementConsumption(a, orders)])), [rows, orders])

  const columns: DataColumn<AgreementRow>[] = [
    {
      key: "agreement",
      header: a2("col_agreement"),
      cell: (a) => (
        <>
          <button
            type="button"
            onClick={() => onOpen(a.id)}
            className="rounded font-bold tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            dir="ltr"
          >
            {displayAgreementNumber(a.docNumber, locale)}
          </button>
          <span className="block text-xs font-normal text-muted-foreground" dir="auto">
            {a.supplierName || "—"}
          </span>
        </>
      ),
    },
    {
      key: "items",
      header: a2("col_material"),
      cell: (a) => (
        <ul className="space-y-1">
          {(a.lines || []).map((l, i) => (
            <li key={i}>
              <span dir="auto">{l.name}</span>
              <span className="text-muted-foreground">
                {" — "}
                <b className="tabular-nums text-foreground" dir="ltr">
                  {priceText(l.price)}
                </b>
                {` / ${l.unit}`}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "validity",
      header: a2("col_validity"),
      cell: (a) => (
        <span className="text-xs">
          {fmtDate(a.from, locale)} <span className="text-muted-foreground">→</span> <span className={cn(a.state === "expiring" && "font-bold text-warning")}>{fmtDate(a.until, locale)}</span>
        </span>
      ),
    },
    {
      key: "cap",
      header: a2("col_cap"),
      cell: (a) => (
        <ul className="space-y-1.5">
          {(consumption.get(a.id) || []).map((c, i) => (
            <li key={i} className="text-xs">
              {c.cap == null ? (
                <span className="text-muted-foreground">{a2("no_cap", { consumed: plain(c.consumed), unit: c.unit })}</span>
              ) : (
                <>
                  <span className="tabular-nums" dir="ltr">
                    {a2("cap_of", { used: plain(c.consumed), cap: plain(c.cap), unit: c.unit })}
                  </span>
                  <span className="mt-0.5 block h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className={cn("block h-full rounded-full", (c.usedPercent ?? 0) >= 100 ? "bg-destructive" : (c.usedPercent ?? 0) >= 80 ? "bg-warning" : "bg-module")} style={{ width: `${Math.min(100, c.usedPercent ?? 0)}%` }} />
                  </span>
                  {(c.usedPercent ?? 0) > 100 && <span className="text-[11px] font-bold text-destructive">{a2("over")}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      ),
    },
    { key: "status", header: a2("col_status"), cell: (a) => <StatusPill tone={TONE[a.state]}>{t(`state.${a.state}`)}</StatusPill> },
    { key: "orders", header: a2("col_orders"), numeric: true, cell: (a) => <Figure>{counts.get(a.id) || 0}</Figure> },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      caption={a2("table")}
      labels={{ sortBy: (c) => c, showMore: (n) => a2("more", { count: n }) }}
      pageSize={24}
      cardTitleKey="agreement"
      empty={empty ?? <EmptyState icon={Handshake} title={t("agreements.noMatch")} />}
    />
  )
}
