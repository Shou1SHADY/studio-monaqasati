"use client"

// The goods receipt as the supplier reads it (PRD ORD-12, B-01): a digital document the CONTRACTOR issued — its number
// and the order's, who recorded it and when, the site, the arrival date, what arrived, what was accepted, what was not,
// the receiver's note and the attachments. No signature, no printing, no driver and no supplier rows.

import { Camera, Scale, ShieldCheck, Award } from "lucide-react"
import type { Deal, DealReceipt } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import { docWord } from "./ui"

const CHK: Record<string, { icon: typeof Camera; key: string }> = {
  ph: { icon: Camera, key: "chkPh" },
  wt: { icon: Scale, key: "chkWt" },
  cert: { icon: Award, key: "chkCert" },
}

export function ReceiptDoc({ f, d, r }: { f: Free; d: Deal; r: DealReceipt }) {
  const { t, fmt } = f
  const c = f.L.C(d.c)
  const rows = Object.entries(r.items).map(([k, q]) => {
    const item = d.items.find((i) => i.id === k)
    const got = r.got[k] != null ? r.got[k] : q
    return { item, q, got, rej: q - got, why: r.why?.[k] }
  })
  const evidence = (r.chk || []).filter((k) => CHK[k])
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div>
          <b className="block text-sm">{t("grnDocT")}</b>
          <span className="text-xs text-muted-foreground">
            {docWord(f, "grn", r.no || "")} · {d.po ? docWord(f, "po", d.po.no) : ""}
          </span>
        </div>
        <div className="text-end">
          <b className="block text-sm">
            <bdi>{c?.name}</bdi>
          </b>
          <span className="text-xs text-muted-foreground">{t("grnIssuer")}</span>
        </div>
      </div>
      <div className="flex items-start gap-2 border-b px-4 py-2.5 text-xs">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        <span>{t("grnStamp", { b: r.by || "—", x: `${fmt.date(r.okAt, true)}${r.t ? ` — ${r.t}` : ""}` })}</span>
      </div>
      <dl className="grid gap-2 border-b px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("fSite")}</dt>
          <dd className="font-bold">
            <bdi>{d.po?.site || "—"}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("grnArrivedL")}</dt>
          <dd className="font-bold">{fmt.date(r.date, true)}</dd>
        </div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start">{t("thItem")}</th>
              <th className="px-3 text-start">{t("thArrived")}</th>
              <th className="px-3 text-start">{t("thAccepted")}</th>
              <th className="px-3 text-start">{t("thRej")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i} className="border-t">
                <td className="px-4 py-2 font-bold">
                  <bdi>{x.item?.name}</bdi>
                  {x.why && <span className="block text-xs font-normal text-destructive">{x.why}</span>}
                </td>
                <td className="px-3 tabular-nums" dir="ltr">
                  {fmt.n(x.q)} {x.item?.unit}
                </td>
                <td className="px-3 font-bold tabular-nums" dir="ltr">
                  {fmt.n(x.got)}
                </td>
                <td className={x.rej ? "px-3 font-bold tabular-nums text-destructive" : "px-3 tabular-nums"} dir="ltr">
                  {fmt.n(x.rej)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.note && (
        <p className="border-t bg-warning/5 px-4 py-2.5 text-xs">
          <b>{t("grnNoteT")}</b> {r.note}
        </p>
      )}
      {evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs">
          <span className="font-bold text-muted-foreground">{t("grnEvidence")}</span>
          {evidence.map((k) => {
            const I = CHK[k].icon
            return (
              <span key={k} className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-0.5">
                <I size={12} aria-hidden="true" />
                {t(CHK[k].key as "chkPh")}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
