// «أين ذهب أثر السند» (prototype `grnFx`): what a confirmed receipt does in each module the company has — Procurement always
// (the order and its next step), then only the connectors that are on and only where the goods landed. Without Finance the
// receipt goes into the period's accounting export instead of a second match leg. Pure; the words are `Portal.ProcReceipts.fx`.

import type { DestKind } from "./receipt-desk"

export type EffectKey = "core" | "inv" | "pm" | "mfg" | "fin" | "fin_off"
export type EffectModule = "core" | "inv" | "pm" | "mfg" | "fin"

export interface ReceiptEffect {
  module: EffectModule
  key: EffectKey
}

export interface EffectInput {
  dest: DestKind | null
  /** The order is a workshop purchase: its material reaches the work order's store. */
  workshop: boolean
  pmOn: boolean
  mfgOn: boolean
  finOn: boolean
}

export function receiptEffects({ dest, workshop, pmOn, mfgOn, finOn }: EffectInput): ReceiptEffect[] {
  const out: ReceiptEffect[] = [{ module: "core", key: "core" }]
  if (dest === "inv" && !workshop) out.push({ module: "inv", key: "inv" })
  if (dest === "prj" && pmOn) out.push({ module: "pm", key: "pm" })
  if (workshop && mfgOn) out.push({ module: "mfg", key: "mfg" })
  out.push(finOn ? { module: "fin", key: "fin" } : { module: "core", key: "fin_off" })
  return out
}
