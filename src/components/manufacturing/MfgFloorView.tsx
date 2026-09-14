"use client"

// The shop floor: what every department holds right now (the board), and the
// delivery notes that carry finished quantity out of the workshop. The chosen
// segment lives in the URL (?seg=notes) so a note list can be linked to.

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { usePathname, useRouter } from "@/i18n/routing"
import { useMfgUi } from "./MfgUiContext"
import { MfgSegments } from "./ui/MfgUi"
import { MfgFloorBoard } from "./MfgFloorBoard"
import { MfgFloorNotes } from "./MfgFloorNotes"

type FloorSegment = "board" | "notes"

export function MfgFloorView() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const urlSegment: FloorSegment = params?.get("seg") === "notes" ? "notes" : "board"
  // The URL is the source of truth; the pending choice shows at once while the
  // soft navigation catches up, and yields as soon as the URL moves.
  const [pending, setPending] = useState<{ from: FloorSegment; to: FloorSegment } | null>(null)
  const segment = pending && pending.from === urlSegment ? pending.to : urlSegment

  const changeSegment = (next: FloorSegment) => {
    if (next === segment) return
    setPending({ from: urlSegment, to: next })
    const qs = new URLSearchParams(params?.toString() || "")
    if (next === "board") qs.delete("seg")
    else qs.set("seg", next)
    const query = qs.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const inTransit = ui.data.notes.filter((n) => n.status === "in_transit" && ui.viewById.has(n.source?.workOrderId)).length

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MfgSegments<FloorSegment>
          label={t("mfg3_tab_floor")}
          value={segment}
          onChange={changeSegment}
          items={[
            { id: "board", label: t("mfg3_floor_seg_board") },
            { id: "notes", label: t("mfg3_floor_seg_notes"), count: inTransit || undefined },
          ]}
        />
      </div>
      {segment === "notes" ? <MfgFloorNotes /> : <MfgFloorBoard />}
    </div>
  )
}
