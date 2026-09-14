"use client"

// The printable delivery note (DN-06): the driver's copy with numbered pieces,
// crates, the fleet vehicle and driver, and boxes for the driver's and the
// receiver's signatures. Printed from a hidden frame so no pop-up blocker
// stands in the way; the layout follows the reader's language and direction.

import { useCallback } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import type { CutPiece } from "@/lib/manufacturing-engine"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { OrderView } from "@/lib/manufacturing-view"
import { fmtQty } from "./ui/MfgUi"

export interface PrintableNote {
  noteNumber: string
  date: string
  workOrderRef: string
  productName: string
  quantity: number
  unit: string
  pieces: number | null
  crates: number | null
  destination: string
  vehicle: string | null
  driver: string | null
  sender: string | null
  note: string | null
  cutList: CutPiece[]
}

type NoteExtras = DeliveryNote & { vehicleLabel?: string | null }

export function printableFromNote(n: DeliveryNote, view: OrderView): PrintableNote {
  const x = n as NoteExtras
  return {
    noteNumber: n.noteNumber,
    date: n.sentAt,
    workOrderRef: view.ref,
    productName: n.item.name || view.product.name,
    quantity: n.item.quantity,
    unit: n.item.unit || view.unit,
    pieces: n.pieces ?? null,
    crates: n.crates ?? null,
    destination: n.toWarehouseName,
    vehicle: [x.vehicleLabel, n.vehiclePlate].filter(Boolean).join(" · ") || null,
    driver: n.driverName ?? null,
    sender: n.sentByUserName || null,
    note: n.receivedNote && n.status === "in_transit" ? n.receivedNote : null,
    cutList: view.calc.slice.drawing?.cutList || [],
  }
}

const esc = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** Returns a function that prints one note. */
export function useDeliveryNotePrint(): (note: PrintableNote) => void {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { user } = useUser()
  const { profile } = useResolvedProfile(user?.uid)
  const company = (profile as { companyName?: string } | null)?.companyName || ""

  return useCallback(
    (n: PrintableNote) => {
      if (typeof window === "undefined") return
      const rtl = locale === "ar"
      const date = new Intl.DateTimeFormat(rtl ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(n.date || Date.now()))
      const row = (k: string, v: string | null) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : "")
      const ltr = (v: string | number) => `<bdi dir="ltr">${esc(v)}</bdi>`
      const pieces = n.cutList.length
        ? `<h2>${esc(t("mfo_print_pieces"))}</h2>
          <table class="grid"><thead><tr>
            <th>${esc(t("mfo_cut_no"))}</th><th>${esc(t("mfo_print_size"))}</th><th>${esc(t("mfo_cut_thickness"))}</th><th>${esc(t("mfo_cut_edge"))}</th><th>${esc(t("mfo_cut_cutouts"))}</th><th>${esc(t("mfo_print_check"))}</th>
          </tr></thead><tbody>
          ${n.cutList
            .map(
              (p) =>
                `<tr><td>${ltr(p.no)}</td><td>${ltr(`${fmtQty(p.length)} × ${fmtQty(p.width)}`)}</td><td>${p.thickness != null ? ltr(fmtQty(p.thickness)) : "—"}</td><td>${esc(p.edge || "—")}</td><td>${esc(p.cutouts || "—")}</td><td class="box"></td></tr>`
            )
            .join("")}
          </tbody></table>`
        : ""
      const html = `<!doctype html><html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<title>${esc(t("mfo_print_title"))} ${esc(n.noteNumber)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: ${rtl ? "'Noto Sans Arabic'," : ""} Inter, system-ui, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.6; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0; line-height: 1.6; }
  h2 { font-size: 13px; margin: 18px 0 6px; line-height: 1.6; }
  .company { font-weight: 700; font-size: 14px; }
  .no { font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  table.facts th { width: 32%; text-align: start; font-weight: 600; color: #334155; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
  table.facts td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
  table.grid th, table.grid td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: start; }
  table.grid th { background: #f1f5f9; font-size: 11px; }
  td.box { width: 40px; }
  .signs { display: flex; gap: 16px; margin-top: 28px; }
  .sign { flex: 1; border: 1px solid #94a3b8; border-radius: 6px; padding: 10px; min-height: 110px; }
  .sign b { display: block; margin-bottom: 44px; }
  .line { border-top: 1px dashed #94a3b8; padding-top: 4px; color: #64748b; font-size: 10px; }
  footer { margin-top: 18px; color: #64748b; font-size: 10px; }
</style></head><body>
<header>
  <div>${company ? `<div class="company">${esc(company)}</div>` : ""}<h1>${esc(t("mfo_print_title"))}</h1></div>
  <div style="text-align:end"><div class="no">${ltr(n.noteNumber)}</div><div>${esc(date)}</div></div>
</header>
<table class="facts"><tbody>
  ${row(t("mfo_print_work_order"), ltr(n.workOrderRef))}
  ${row(t("mfo_print_product"), esc(n.productName))}
  ${row(t("mfo_qty"), `${ltr(fmtQty(n.quantity))} ${esc(n.unit)}`)}
  ${row(t("mfo_dn_pieces"), n.pieces != null ? ltr(n.pieces) : null)}
  ${row(t("mfo_dn_crates"), n.crates != null ? ltr(n.crates) : null)}
  ${row(t("mfo_dn_destination"), esc(n.destination))}
  ${row(t("mfo_print_vehicle"), n.vehicle ? esc(n.vehicle) : null)}
  ${row(t("mfo_print_driver"), n.driver ? esc(n.driver) : null)}
  ${row(t("mfo_print_sender"), n.sender ? esc(n.sender) : null)}
  ${row(t("mfo_note"), n.note ? esc(n.note) : null)}
</tbody></table>
${pieces}
<div class="signs">
  <div class="sign"><b>${esc(t("mfo_print_sign_driver"))}</b><div class="line">${esc(t("mfo_print_sign_line"))}</div></div>
  <div class="sign"><b>${esc(t("mfo_print_sign_receiver"))}</b><div class="line">${esc(t("mfo_print_sign_line_date"))}</div></div>
</div>
<footer>${esc(t("mfo_print_footer"))}</footer>
</body></html>`

      const frame = document.createElement("iframe")
      frame.setAttribute("aria-hidden", "true")
      frame.style.position = "fixed"
      frame.style.width = "0"
      frame.style.height = "0"
      frame.style.border = "0"
      frame.style.insetInlineEnd = "0"
      frame.style.bottom = "0"
      document.body.appendChild(frame)
      const win = frame.contentWindow
      const doc = win?.document
      if (!win || !doc) {
        frame.remove()
        return
      }
      doc.open()
      doc.write(html)
      doc.close()
      let printed = false
      const go = () => {
        if (printed) return
        printed = true
        win.focus()
        win.print()
        window.setTimeout(() => frame.remove(), 60_000)
      }
      const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
      if (fonts?.ready) void fonts.ready.then(() => window.setTimeout(go, 150))
      window.setTimeout(go, 1500)
    },
    [t, locale, company]
  )
}
