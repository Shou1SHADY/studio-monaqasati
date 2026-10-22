"use client"

// The free supplier's side of the ORDER's conversation (MSG-01): once an order is sent to him, the buyer writes to him here and he
// answers from his portal — the same thread the buyer reads in «محادثاتي», with the order's own events in it. (The deal's earlier
// conversation, about the quotation, stays in «المحادثة».)

import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { FileText } from "lucide-react"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { ConversationPanel } from "@/components/procurement/chats/ConversationPanel"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import type { PoWithChat } from "@/lib/procurement/po-messages"
import type { Deal } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"

export function SecOrderChat({ f, d }: { f: Free; d: Deal }) {
  const t = useTranslations("Portal.ProcChats")
  const firestore = useFirestore()
  const poId = (f.rawOffer(d.id) as { poId?: string } | null)?.poId || ""
  const ref = useMemoFirebase(() => (firestore && poId ? doc(firestore, PURCHASE_ORDERS, poId) : null), [firestore, poId])
  const { data } = useDoc<Omit<PurchaseOrder, "id">>(ref)
  if (!data || !data.sentAt || !data.supplierOrgId) return null
  const po = { ...data, id: poId, lines: data.lines || [], log: data.log || [] } as PoWithChat
  return (
    <DrawerSection title={<span className="inline-flex items-center gap-2"><FileText size={15} aria-hidden="true" />{t("thread_title_supplier")}</span>} defaultOpen={false}>
      <ConversationPanel po={po} side="supplier" orgId={po.supplierOrgId} company={f.L.C(d.c)?.name || ""} className="py-2" />
    </DrawerSection>
  )
}
