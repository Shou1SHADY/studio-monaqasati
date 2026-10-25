"use client"

// One order's conversation, live: the thread (messages and the order's own facts), the box to write in, and the doors around it —
// the full conversation, a call, the order link as the supplier sees it. Used by the order drawer's «التواصل مع المورّد» (the last
// four lines), by «محادثاتي» (all of it) and by the supplier's portal (his side). It reads `poMessages` through the one rule that
// lets the two companies' members in; every write goes through the routes. For an off-platform supplier "send" stores the message
// and opens WhatsApp on THIS device with the message and the order link (no integration, B-08).

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where, type Firestore } from "firebase/firestore"
import { Eye, MessageSquare, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { displayPoNumber } from "@/lib/procurement/format"
import { bareOrderNo } from "@/lib/po-link"
import { buildWhatsAppLink } from "@/utils/guest-offer-workflow"
import { fetchPoLink, markPoRead, sendPoMessage, uploadPoMessageFile } from "@/lib/procurement/po-message-client"
import { POLL_MESSAGES, lastLines, threadOf, unreadForBuyer, unreadForSupplier, type PoMessage, type PoWithChat, type ThreadReceipt } from "@/lib/procurement/po-messages"
import { cn } from "@/lib/utils"
import { Composer } from "./Composer"
import { ThreadBody, type ThreadSide } from "./ThreadBody"
import { PoLinkPreviewSheet } from "./PoLinkPreviewSheet"

/** The off-platform supplier's channel (MSG-05, no integration): WhatsApp opened on THIS device with the words and a fresh order
 * link. Shared by «أرسل» here and the drawer's «ذكّر المورد» (PO-09). The caller opens the blank window synchronously in the click
 * (a pop-up blocker allows only that) and hands it in. */
export async function openWhatsAppWithLink(poId: string, phone: string | null, text: string, opened: Window | null): Promise<void> {
  const link = await fetchPoLink(poId)
  const body = `${text}\n${link}`
  const url = buildWhatsAppLink(phone, body) ?? `https://wa.me/?text=${encodeURIComponent(body)}`
  if (opened) opened.location.href = url
  else window.open(url, "_blank", "noopener")
}

/** The order's messages, live. The query names the viewer's company, which is what the rule can prove. */
export function usePoMessages(po: Pick<PoWithChat, "id" | "organizationId">, side: ThreadSide, orgId: string): { messages: PoMessage[]; loading: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore as Firestore, POLL_MESSAGES), where("poId", "==", po.id), where(side === "buyer" ? "organizationId" : "supplierOrgId", "==", orgId))
  }, [firestore, po.id, orgId, side])
  const { data, isLoading } = useCollection<PoMessage>(q)
  const messages = useMemo(() => [...(data || [])].sort((a, b) => a.seq - b.seq), [data])
  return { messages, loading: isLoading }
}

export function ConversationPanel({
  po,
  side,
  orgId,
  receipts = [],
  phone = null,
  compact = false,
  company = "",
  className,
}: {
  po: PoWithChat
  side: ThreadSide
  /** The viewer's company: the buyer's, or the supplier's. */
  orgId: string
  receipts?: ThreadReceipt[]
  phone?: string | null
  /** The drawer: the last four lines and the doors to more. */
  compact?: boolean
  /** The buying company's name, as the supplier reads it. */
  company?: string
  className?: string
}) {
  const t = useTranslations("Portal.ProcChats")
  const locale = useLocale() as "ar" | "en"
  const { toast } = useToast()
  const { user } = useUser()
  const { messages } = usePoMessages(po, side, orgId)
  const thread = useMemo(() => threadOf(po, messages, receipts), [po, messages, receipts])
  const { shown, older } = compact ? lastLines(thread) : { shown: thread, older: 0 }
  const offPlatform = side === "buyer" && (Boolean(po.isGuestSupplier) || !po.supplierUserId)
  const cancelled = po.status === "cancelled"
  const no = side === "buyer" ? displayPoNumber(po.docNumber, locale) : bareOrderNo(po.docNumber)
  const unread = side === "buyer" ? (user ? unreadForBuyer(po, user.uid) : false) : unreadForSupplier(po)
  const readFor = useRef<string>("")
  // «رابط الأمر كما يراه» opens a read-only preview (PO-02) — never the live link, which would act in the supplier's name.
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    if (!unread || cancelled) return
    const mark = `${po.id}:${po.chat?.supSeq ?? 0}:${po.chat?.usSeq ?? 0}`
    if (readFor.current === mark) return
    readFor.current = mark
    void markPoRead(po.id).catch(() => undefined)
  }, [unread, cancelled, po.id, po.chat?.supSeq, po.chat?.usSeq])

  const onSend = async ({ text, file }: { text: string; file: { name: string; url: string } | null }) => {
    const opened = offPlatform ? window.open("", "_blank") : null
    try {
      await sendPoMessage({ poId: po.id, text: text.trim() || null, file, channel: offPlatform ? "whatsapp" : "portal", locale })
      if (offPlatform) await openWhatsAppWithLink(po.id, phone, text.trim() || file?.name || "", opened)
      toast({ title: t(offPlatform ? "sent_whatsapp_toast" : "sent_portal_toast") })
    } catch (err) {
      opened?.close()
      throw err
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {side === "buyer" && <p className="text-xs text-muted-foreground">{t(offPlatform ? "channel_link" : "channel_portal")}</p>}
      {older > 0 && (
        <Link href={`/contractor/chats?po=${po.id}`} className="inline-block text-[11px] font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("older", { count: older })}
        </Link>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("no_messages")}</p>
      ) : (
        <ThreadBody items={shown} side={side} no={no} supplierName={po.supplierName} company={company} offPlatform={offPlatform} />
      )}
      {cancelled ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("cancelled_note")}</p>
      ) : (
        <Composer placeholder={t(side === "buyer" ? "write_supplier" : "write_buyer")} whatsapp={offPlatform} onSend={onSend} onUpload={(f) => uploadPoMessageFile(po.id, f)} />
      )}
      {side === "buyer" && (
        <div className="flex flex-wrap items-center gap-2">
          {compact && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/contractor/chats?po=${po.id}`}>
                <MessageSquare size={14} aria-hidden="true" />
                {t("full")}
              </Link>
            </Button>
          )}
          {phone && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                <Phone size={14} aria-hidden="true" />
                {t("call")}
              </a>
            </Button>
          )}
          {offPlatform && !cancelled && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPreview(true)}>
              <Eye size={14} aria-hidden="true" />
              {t("order_link_as")}
            </Button>
          )}
        </div>
      )}
      {side === "buyer" && offPlatform && !cancelled && <PoLinkPreviewSheet poId={po.id} supplierName={po.supplierName} open={preview} onOpenChange={setPreview} />}
    </div>
  )
}
