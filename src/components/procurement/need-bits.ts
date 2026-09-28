import { Boxes, Factory, FileSignature, Scale, ShoppingCart, type LucideIcon } from "lucide-react"
import type { PillTone } from "@/components/module-ui/StatusPill"
import type { LineState, NeedPath } from "@/lib/procurement/need-desk"

export const PATH_ICON: Record<NeedPath, LucideIcon> = { stock: Boxes, agreement: FileSignature, direct: ShoppingCart, rfq: Scale, mfg: Factory }
export const PATH_TONE: Record<NeedPath, PillTone> = { stock: "warn", agreement: "ok", direct: "info", rfq: "violet", mfg: "module" }

export const LINE_STATE_TONE: Record<LineState, PillTone> = {
  open: "warn",
  late: "warn",
  mfgl: "warn",
  chk: "mute",
  mfgw: "mute",
  mfg: "violet",
  rfq: "info",
  po: "module",
  done: "ok",
  stk: "ok",
  cx: "mute",
}

export const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")

/** `YYYY-MM-DD` (or ISO) → a short day in the reader's script, Western digits. */
export function fmtDay(day: string | null | undefined, locale: string): string {
  if (!day) return ""
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}
