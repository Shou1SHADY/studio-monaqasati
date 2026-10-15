"use client"

// One place that knows how to do what a supplier does to a deal: a button anywhere (a task card, a row, the deal
// drawer) calls `open(kind, dealId)`; the matching window opens over whatever page he is on, and closes when it is done.
// Direct acts (a reminder) run without a window and say so with a toast.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { Translator } from "@/lib/mfg-events"
import type { SupplierSide } from "@/lib/supplier-free/events"
import { remindReceipt, SupplierPoError } from "@/lib/supplier-free/po-writes"
import { remindPayment, transferArrivedLater } from "@/lib/supplier-free/money-writes"
import type { Firestore } from "firebase/firestore"
import { ActionDialogs } from "./ActionDialogs"
import { useFree, type Free } from "./useFree"

export type ActionKind =
  | "accept-po"
  | "decline-po"
  | "deliver"
  | "remind"
  | "invoice"
  | "pay-ok"
  | "pay-miss"
  | "pay-remind"
  | "pay-late"
  | "sample-sent"
  | "final"
  | "withdraw"
  | "no-quote"
  | "warranty"
  | "rate"
  | "grn"

interface Open {
  kind: ActionKind
  dealId: string
  /** A receipt number for "grn", a transfer id for the transfer acts. */
  ref?: string
}

interface Ctx {
  open: (kind: ActionKind, dealId: string, ref?: string) => void
  close: () => void
  current: Open | null
}

const ActionsCtx = createContext<Ctx | null>(null)

export function useActions(): Ctx {
  const c = useContext(ActionsCtx)
  if (!c) throw new Error("useActions outside ActionsProvider")
  return c
}

/** What every write needs: the database, who acts and as which company, and the notice copy in the supplier's language. */
export interface WriteEnv {
  firestore: Firestore
  uid: string
  orgId: string
  userName: string
  company: string
  side: SupplierSide
}

export function useWriteEnv(): WriteEnv | null {
  const firestore = useFirestore()
  const { user } = useUser()
  const f = useFree()
  const shared = useTranslations("Portal.Shared")
  const { profile } = f
  return useMemo(() => {
    if (!firestore || !user || !profile) return null
    const userName = profile.name || user.email || ""
    return {
      firestore,
      uid: user.uid,
      orgId: profile.orgId,
      userName,
      company: profile.companyName,
      side: { company: profile.companyName, actor: { uid: user.uid, name: userName }, copy: shared as unknown as Translator },
    }
  }, [firestore, user, profile, shared])
}

const PO_ERROR_KEY: Record<string, string> = {
  wrong_state: "errPoState",
  date_missing: "blkDate",
  date_past: "blkCommitPast",
  date_future: "blkRepFuture",
  reason_missing: "blkReason",
  already_reported: "errAlreadyReported",
  nothing_left: "errNothingLeft",
  no_report: "errNoReport",
  reminded_today: "errRemindedToday",
}

export function poErrorText(f: Free, err: unknown): string {
  if (err instanceof SupplierPoError) return f.t((PO_ERROR_KEY[err.code] || "errSave") as "errSave")
  return f.t("errSave")
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const f = useFree()
  const { toast } = useToast()
  const env = useWriteEnv()
  const [current, setCurrent] = useState<Open | null>(null)
  const close = useCallback(() => setCurrent(null), [])

  const open = useCallback(
    (kind: ActionKind, dealId: string, ref?: string) => {
      const d = f.world.deals.find((x) => x.id === dealId)
      const po = f.poOf(dealId)
      // Direct acts: no window, just the act and its toast.
      if (kind === "remind" && env && po) {
        void remindReceipt(env.firestore, env.side, env.orgId, po.id)
          .then(() => toast({ title: f.t("tReminded") }))
          .catch((err) => toast({ title: poErrorText(f, err), variant: "destructive" }))
        return
      }
      if (kind === "pay-late" && env && po && ref) {
        const t = d?.pays.find((p) => p.id === ref)
        if (t)
          void transferArrivedLater(env.firestore, env.side, po, { id: ref, amount: t.amt, bank: t.bank, ref: t.ref, state: t.st })
            .then(() => toast({ title: f.t("tPayLateOk") }))
            .catch(() => toast({ title: f.t("errSave"), variant: "destructive" }))
        return
      }
      if (kind === "pay-remind" && env && po && d) {
        const nd = f.L.nextDue(d)
        const offer = f.rawOffer(dealId)
        if (!nd || !offer) return
        void remindPayment(env.firestore, env.side, {
          po,
          offer,
          chatId: offer.id,
          text: f.t("msgPayRemind", { v: f.fmt.money(nd.amt), x: f.fmt.date(nd.due, true) }),
          due: nd.due,
          amount: nd.amt,
          orgId: env.orgId,
        })
          .then((r) => toast({ title: f.t(r === "sent" ? "tPayRemind" : "errRemindedToday") }))
          .catch(() => toast({ title: f.t("errSave"), variant: "destructive" }))
        return
      }
      setCurrent({ kind, dealId, ref })
    },
    [f, env, toast]
  )

  const value = useMemo(() => ({ open, close, current }), [open, close, current])
  return (
    <ActionsCtx.Provider value={value}>
      {children}
      {current && <ActionDialogs key={`${current.kind}:${current.dealId}:${current.ref || ""}`} open={current} onClose={close} />}
    </ActionsCtx.Provider>
  )
}
