/**
 * Procurement PRD 3.0 — every key the domain layer can emit exists in BOTH
 * message files, under `Portal.Procurement` and `Portal.ProcToday`. The
 * domain emits keys, never sentences; a missing key would surface on screen
 * as the key itself. (The fragments are merged into messages/*.json by the
 * lead — this suite is red until that merge lands.)
 */

import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import {
  AWARD_REASON_CODES,
  BLOCK_CODES,
  HOLD_REASON_CODES,
  PO_BASES,
  PO_LOG_ACTIONS,
  PO_SEND_CHANNELS,
  PO_STATUSES,
  RECEIPT_CHECKS,
  REFUSAL_CODES,
  REJECT_DECISIONS,
  REJECT_REASON_CODES,
} from "@/lib/procurement/po"
import { RECEIPT_ERROR_CODES, RECEIPT_STATES } from "@/lib/procurement/receipts"
import { COMMITMENT_BUCKETS, EXCEPTION_KINDS } from "@/lib/procurement/reports"
import { TODAY_KEYS } from "@/lib/procurement/today"

type Tree = { [k: string]: string | Tree }

function lookup(tree: Tree | undefined, path: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of path.split(".")) {
    if (!node || typeof node === "string") return undefined
    node = node[part]
  }
  return typeof node === "string" ? node : undefined
}

const missing = (messages: Tree, ns: string, keys: readonly string[]) => keys.filter((k) => lookup(messages, `Portal.${ns}.${k}`) === undefined)

const PROCUREMENT_KEYS = [
  ...PO_STATUSES.map((s) => `status.${s}`),
  "status.closed_short",
  ...PO_BASES.map((b) => `basis.${b}`),
  ...PO_SEND_CHANNELS.map((c) => `channel.${c}`),
  "approver.manager",
  "approver.owner",
  "selfApproval",
  ...BLOCK_CODES.map((c) => `blocks.${c}`),
  ...REFUSAL_CODES.map((c) => `refusal.${c}`),
  ...AWARD_REASON_CODES.map((c) => `awardReason.${c}`),
  ...REJECT_REASON_CODES.map((c) => `rejectReason.${c}`),
  ...HOLD_REASON_CODES.map((c) => `holdReason.${c}`),
  ...REJECT_DECISIONS.map((c) => `rejectDecision.${c}`),
  ...RECEIPT_CHECKS.map((c) => `checklist.${c}`),
  ...RECEIPT_STATES.map((s) => `receiptState.${s}`),
  ...RECEIPT_ERROR_CODES.map((c) => `receiptError.${c}`),
  ...PO_LOG_ACTIONS.map((a) => `log.${a}`),
  ...EXCEPTION_KINDS.map((k) => `exception.${k}`),
  ...COMMITMENT_BUCKETS.map((b) => `commitmentBucket.${b}`),
  "deliveryState.on_time",
  "deliveryState.late",
  "deliveryState.on_time_so_far",
  "deliveryState.pending",
  "doc.PO",
  "doc.GR",
  "noRecord",
]

describe("Portal.Procurement — the shared vocabulary", () => {
  it("every code has an Arabic sentence", () => expect(missing(ar as Tree, "Procurement", PROCUREMENT_KEYS)).toEqual([]))
  it("every code has an English sentence", () => expect(missing(en as Tree, "Procurement", PROCUREMENT_KEYS)).toEqual([]))
})

describe("Portal.ProcToday — every key the queue, the waits and the tiles emit", () => {
  it("Arabic", () => expect(missing(ar as Tree, "ProcToday", TODAY_KEYS)).toEqual([]))
  it("English", () => expect(missing(en as Tree, "ProcToday", TODAY_KEYS)).toEqual([]))
})
