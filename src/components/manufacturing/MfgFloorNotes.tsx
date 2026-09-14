"use client"

// Delivery notes out of the workshop, newest first. A note moves
// responsibility for the goods; nothing is costed or invoiced until the
// receiver confirms it, and transit breakage is recorded on the note.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgEmpty, MfgNote, MfgPanel, MfgPill, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

const DEST_KEY: Record<DeliveryNote["toKind"], string> = {
  project: "mfg3_floor_dest_project",
  central: "mfg_map_central_tag",
  outbound: "mfg_map_outbound_tag",
}

function noteState(n: DeliveryNote): { tone: MfgTone; key: string } {
  if (n.status === "in_transit") return { tone: "info", key: "mfg2_note_in_transit" }
  if (n.status === "rejected") return { tone: "muted", key: "mfg2_note_rejected" }
  if ((n.brokenQuantity || 0) > 0) return { tone: "bad", key: "mfg3_floor_note_received_broken" }
  return { tone: "ok", key: "mfg2_note_received" }
}

export function MfgFloorNotes() {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const { data, perms, viewById, openOrder, openAction } = useMfgUi()
  const canConfirm = perms.canReceive || perms.canManage

  const rows = useMemo(
    () =>
      data.notes
        .map((note) => ({ note, view: viewById.get(note.source?.workOrderId) }))
        .filter((r): r is { note: DeliveryNote; view: OrderView } => !!r.view)
        .sort((a, b) => (a.note.sentAt < b.note.sentAt ? 1 : a.note.sentAt > b.note.sentAt ? -1 : 0)),
    [data.notes, viewById]
  )

  return (
    <div className="min-w-0 space-y-3">
      <MfgNote tone="info" title={t("mfg3_floor_notes_title")}>
        {t("mfg3_floor_notes_body")}
      </MfgNote>

      <MfgPanel>
        {rows.length === 0 ? (
          <MfgEmpty icon={Truck} title={t("mfg3_floor_notes_empty")} hint={t("mfg3_floor_notes_empty_hint")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] font-bold text-muted-foreground">
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-start">{t("mfg3_floor_th_note")}</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-start">{t("mfg3_floor_th_order")}</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-start">{t("mfg2_field_destination")}</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-start">{t("mfg3_floor_th_shipment")}</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-start">{t("mfg3_floor_th_state")}</th>
                  <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-end">{t("mfg3_floor_th_action")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ note: n, view: v }) => {
                  const state = noteState(n)
                  const unit = n.item.unit || v.unit
                  const shipment = [
                    n.pieces ? t("mfg3_floor_pieces", { count: n.pieces }) : null,
                    n.crates ? t("mfg3_floor_crates", { count: n.crates }) : null,
                    n.driverName || null,
                  ].filter(Boolean)
                  const resolvedAt = n.receivedAt ? d.short(n.receivedAt) : null
                  return (
                    <tr
                      key={n.id}
                      onClick={() => openOrder(v.id)}
                      className="cursor-pointer border-b border-border/60 align-middle transition-colors last:border-b-0 hover:bg-muted/40"
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                            <Truck size={15} aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <span className="block font-mono text-xs font-bold text-foreground" dir="ltr">
                              {n.noteNumber}
                            </span>
                            <span className="block whitespace-nowrap text-[11px] text-muted-foreground" dir="auto">
                              {t("mfg3_floor_note_sent", { date: d.short(n.sentAt), by: n.sentByUserName || "—" })}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openOrder(v.id)
                          }}
                          className="flex min-h-11 flex-col justify-center rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <span className="block text-xs font-bold tabular-nums text-foreground hover:underline" dir="ltr">
                            #{v.number}
                          </span>
                          <span className="block text-[11px] text-muted-foreground" dir="auto">
                            {v.product.name}
                          </span>
                        </button>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="block font-semibold text-foreground" dir="auto">
                          {n.toWarehouseName}
                        </span>
                        <span className="block text-[11px] text-muted-foreground" dir="auto">
                          {[t(DEST_KEY[n.toKind] || DEST_KEY.central), v.sourceName].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="block">
                          <b className="tabular-nums text-foreground">{fmtQty(n.item.quantity)}</b>{" "}
                          <span className="text-muted-foreground" dir="auto">
                            {unit}
                          </span>
                        </span>
                        {(shipment.length > 0 || n.vehiclePlate) && (
                          <span className="block text-[11px] text-muted-foreground" dir="auto">
                            {shipment.join(" · ")}
                            {n.vehiclePlate && (
                              <>
                                {shipment.length > 0 && " · "}
                                <bdi dir="ltr">{n.vehiclePlate}</bdi>
                              </>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <MfgPill tone={state.tone} dot>
                            {t(state.key)}
                          </MfgPill>
                          {n.status !== "in_transit" && resolvedAt && (
                            <span className="text-[11px] text-muted-foreground" dir="auto">
                              {n.receivedByUserName
                                ? t(n.status === "rejected" ? "mfg3_floor_note_rejected_by" : "mfg3_floor_note_received_by", {
                                    by: n.receivedByUserName,
                                    date: resolvedAt,
                                  })
                                : resolvedAt}
                            </span>
                          )}
                          {n.status === "rejected" && n.rejectedReason && (
                            <span className="max-w-[220px] text-[11px] text-muted-foreground" dir="auto">
                              {n.rejectedReason}
                            </span>
                          )}
                          {(n.brokenQuantity || 0) > 0 && (
                            <MfgChip tone="bad">{t("mfg2_note_broken", { count: fmtQty(n.brokenQuantity) })}</MfgChip>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-end">
                        {n.status === "in_transit" && canConfirm ? (
                          <Button
                            size="sm"
                            aria-label={t("mfg3_floor_confirm_note_aria", { note: n.noteNumber })}
                            onClick={(e) => {
                              e.stopPropagation()
                              openAction(v.id, { kind: "confirmNote", noteId: n.id })
                            }}
                            className="min-h-11 whitespace-nowrap bg-warning text-warning-foreground hover:bg-warning/90 sm:min-h-9"
                          >
                            {t("mfg_confirm_receipt_btn")}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground" aria-hidden="true">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>
    </div>
  )
}
