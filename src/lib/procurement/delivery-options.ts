// «التسليم» (Procurement 2.0, ED-04): the optional delivery options a buyer sets per delivery place on an RFQ —
// who unloads, the time of day, a note for reaching the site. Kept on the RFQ as `deliveryOptions[siteId]` (a group
// with no stored site is keyed by its group key), read by the RFQ page, the guest link and the supplier's portal,
// and carried onto the order. Pure.

export const UNLOAD_CHOICES = ["supplier", "us"] as const
export const SLOT_CHOICES = ["am", "pm", "any"] as const
export type UnloadChoice = (typeof UNLOAD_CHOICES)[number]
export type SlotChoice = (typeof SLOT_CHOICES)[number]

export const DELIVERY_NOTE_MAX = 300

export interface DeliveryOptions {
  unload?: UnloadChoice | null
  slot?: SlotChoice | null
  note?: string
}

const isUnload = (v: unknown): v is UnloadChoice => (UNLOAD_CHOICES as readonly unknown[]).includes(v)
const isSlot = (v: unknown): v is SlotChoice => (SLOT_CHOICES as readonly unknown[]).includes(v)

/** What is stored of one place's options: only the parts that were chosen, the note trimmed; null when nothing was. */
export function cleanDelivery(raw: unknown): { unload?: UnloadChoice; slot?: SlotChoice; note?: string } | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const note = typeof d.note === "string" ? d.note.trim().slice(0, DELIVERY_NOTE_MAX) : ""
  const out = { ...(isUnload(d.unload) ? { unload: d.unload } : {}), ...(isSlot(d.slot) ? { slot: d.slot } : {}), ...(note ? { note } : {}) }
  return Object.keys(out).length ? out : null
}

/** An RFQ's (or an order's) `deliveryOptions` as stored: every place keeps only what is valid. */
export function readDeliveryOptions(raw: unknown): Record<string, NonNullable<ReturnType<typeof cleanDelivery>>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, NonNullable<ReturnType<typeof cleanDelivery>>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const clean = cleanDelivery(value)
    if (clean && key) out[key] = clean
  }
  return out
}

type Translate = (key: string) => string

/** «التنزيل على المورّد · صباحاً» — the options as the supplier reads them (the note is shown apart). `t` is
 * `Portal.ProcEditor`. */
export function deliveryLine(d: DeliveryOptions | null | undefined, t: Translate): string {
  if (!d) return ""
  return [d.unload ? t(`deliv_unload_${d.unload}`) : "", d.slot ? t(`deliv_slot_${d.slot}`) : ""].filter(Boolean).join(" · ")
}
