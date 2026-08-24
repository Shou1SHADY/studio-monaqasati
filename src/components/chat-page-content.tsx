"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Send, Loader2, MessageSquare, Shield, Clock, User } from "lucide-react"
import { useFirestore, useUser, useMemoFirebase, useCollection, useDoc } from "@/firebase"
import { isSecondaryOrg, identityDocRef } from "@/lib/org-identity"
import { stripIdentityFields } from "@/lib/identity-fields"
import {
  doc, getDoc, setDoc, collection, addDoc, updateDoc, getDocs, increment,
  query, orderBy, where, writeBatch
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"

interface ChatPageContentProps {
  backPath: string
}

interface ChatMessage {
  id: string
  senderId: string
  text: string
  createdAt: any
}

function getInitials(name: string) {
  if (!name) return "?"
  return name.split(" ").map((n) => n.charAt(0).toUpperCase()).join("").slice(0, 2)
}

function formatDateSeparator(date: Date, locale: string, t: any) {
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()

  if (isToday) return t("chat_today")
  if (isYesterday) return t("chat_yesterday")
  return date.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function shouldShowDateSeparator(prev: Date | null, curr: Date) {
  if (!prev) return true
  return prev.toDateString() !== curr.toDateString()
}

export default function ChatPageContent({ backPath }: ChatPageContentProps) {
  const params = useParams()
  const chatId = params.chatId as string
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRTL = locale === 'ar'
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Real-time chat metadata
  const chatDocQuery = useMemoFirebase(() => {
    if (!firestore || !chatId) return null
    return doc(firestore, "chats", chatId)
  }, [firestore, chatId])

  const { data: chatMeta, isLoading: metaLoading } = useDoc(chatDocQuery)

  // Real-time messages
  const messagesQuery = useMemoFirebase(() => {
    if (!firestore || !chatId) return null
    return query(
      collection(firestore, "chats", chatId, "messages"),
      orderBy("createdAt", "asc")
    )
  }, [firestore, chatId])

  const { data: messages, isLoading: messagesLoading } = useCollection(messagesQuery)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Mark chat as read when opened — updates both the chat doc (for web badge)
  // and the notification docs (for mobile unread count)
  useEffect(() => {
    if (!firestore || !chatId || !user || metaLoading || !chatMeta) return
    const unreadFor: string[] = chatMeta.unreadFor || []
    if (unreadFor.includes(user.uid)) {
      updateDoc(doc(firestore, "chats", chatId), {
        unreadFor: unreadFor.filter((uid: string) => uid !== user.uid),
        [`unreadCounts.${user.uid}`]: 0
      }).catch(() => { })

      getDocs(query(
        collection(firestore, "users", user.uid, "notifications"),
        where("chatId", "==", chatId),
        where("read", "==", false)
      )).then((snap) => {
        if (snap.empty) return
        const batch = writeBatch(firestore)
        snap.docs.forEach((d) => batch.update(d.ref, { read: true }))
        return batch.commit()
      }).catch(() => { })
    }
  }, [firestore, chatId, user, chatMeta, metaLoading])

  // Auto-create chat document when it doesn't exist yet (e.g. sample flow before offer acceptance)
  useEffect(() => {
    if (isUserLoading || metaLoading || chatMeta || !user || !firestore || !chatId) return
    ;(async () => {
      try {
        const offerSnap = await getDoc(doc(firestore, "offers", chatId))
        if (!offerSnap.exists()) return
        const offer = offerSnap.data()
        await setDoc(doc(firestore, "chats", chatId), {
          offerId: chatId,
          rfqId: offer.rfqId || "",
          rfqTitle: offer.rfqTitle || offer.title || "",
          contractorId: offer.contractorId || "",
          contractorOrgId: offer.contractorOrgId || offer.contractorId || "",
          supplierId: offer.supplierId || "",
          supplierOrgId: offer.organizationId || offer.supplierId || "",
          createdAt: new Date().toISOString()
        })
      } catch (err) {
        console.warn("chat auto-create:", err)
      }
    })()
  }, [isUserLoading, metaLoading, chatMeta, user, firestore, chatId])

  // Fetch partner user profile
  const partnerId = useMemo(() => {
    if (!chatMeta || !user) return null
    return chatMeta.contractorId === user.uid ? chatMeta.supplierId : chatMeta.contractorId
  }, [chatMeta, user])

  const partnerDocRef = useMemoFirebase(() => {
    if (!firestore || !partnerId) return null
    return doc(firestore, "users", partnerId)
  }, [firestore, partnerId])

  const { data: partnerBase } = useDoc(partnerDocRef)

  // If the chat partner has switched into a secondary company (added via
  // the company-switcher), its identity fields (name/companyName) live on
  // organizations/{id}, not on its own users/{id} doc — see src/lib/org-identity.ts.
  const partnerOrgId = (partnerBase as { organizationId?: string } | null)?.organizationId
  const partnerOrgRole = (partnerBase as { organizationRole?: string } | null)?.organizationRole
  const partnerIsSecondary = isSecondaryOrg(partnerOrgId, partnerId, partnerOrgRole)
  const partnerIdentityRef = useMemoFirebase(() => {
    if (!firestore || !partnerIsSecondary || !partnerOrgId) return null
    return identityDocRef(firestore, partnerOrgId)
  }, [firestore, partnerIsSecondary, partnerOrgId])
  const { data: partnerIdentityOverlay, isLoading: partnerIdentityLoading } = useDoc(partnerIdentityRef)
  // Wait for the overlay to settle before merging — otherwise the primary
  // company's stale identity fields would flash through for one render.
  const partnerProfile = !partnerBase || (partnerIsSecondary && partnerIdentityLoading)
    ? null
    : partnerIsSecondary ? { ...stripIdentityFields(partnerBase), ...(partnerIdentityOverlay || {}) } : partnerBase

  // Determine partner info
  const partnerInfo = useMemo(() => {
    if (!chatMeta || !user) return null
    const isContractor = chatMeta.contractorId === user.uid

    const partnerName = partnerProfile?.name
      || partnerProfile?.displayName
      || chatMeta.supplierName
      || chatMeta.contractorName
      || chatMeta.supplierOrgName
      || chatMeta.contractorOrgName
      || (isContractor ? t("chat_supplier") : t("chat_contractor"))

    const partnerCompany = partnerProfile?.companyName
      || partnerProfile?.orgName
      || chatMeta.supplierOrgName
      || chatMeta.contractorOrgName
      || chatMeta.supplierName
      || chatMeta.contractorName
      || ""

    const partnerRole = isContractor ? t("chat_supplier") : t("chat_contractor")
    return { partnerName, partnerCompany, partnerRole, isContractor }
  }, [chatMeta, user, partnerProfile, t])

  const handleSend = async () => {
    if (!message.trim() || !firestore || !user || !chatId || !chatMeta) return
    setSending(true)
    const msgText = message.trim()
    setMessage("")
    try {
      const otherId = chatMeta.contractorId === user.uid
        ? chatMeta.supplierId
        : chatMeta.contractorId

      // Critical: add the message itself — any error here surfaces to the user
      await addDoc(collection(firestore, "chats", chatId, "messages"), {
        senderId: user.uid,
        text: msgText,
        createdAt: new Date().toISOString()
      })

      // Non-critical: update chat metadata — errors are swallowed so the send
      // still feels successful even if the rules deny this secondary write
      const currentUnread: string[] = chatMeta.unreadFor || []
      const newUnread = otherId && !currentUnread.includes(otherId)
        ? [...currentUnread, otherId]
        : currentUnread

      updateDoc(doc(firestore, "chats", chatId), {
        lastMessage: msgText,
        lastMessageAt: new Date().toISOString(),
        unreadFor: newUnread,
        ...(otherId ? { [`unreadCounts.${otherId}`]: increment(1) } : {})
      }).catch((err) => console.warn("chat metadata update:", err?.code))

      if (otherId) {
        addDoc(
          collection(firestore, "users", otherId, "notifications"),
          {
            type: "new_chat_message",
            message: msgText.length > 80 ? msgText.substring(0, 80) + "..." : msgText,
            chatId: chatId,
            rfqTitle: chatMeta.rfqTitle || "",
            createdAt: new Date().toISOString(),
            read: false
          }
        ).catch(() => { })
      }

    } catch (err: any) {
      console.error("send message failed:", err?.code, err?.message)
      toast({ title: t("chat_error"), description: t("chat_send_failed"), variant: "destructive" })
      setMessage(msgText)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatTime = (ts: any) => {
    if (!ts) return ""
    const d = ts?.toDate ? ts.toDate() : new Date(ts)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: "2-digit", minute: "2-digit" })
  }

  const isLoading = isUserLoading || metaLoading || messagesLoading

  // Build messages with date separators
  const messagesWithDates = useMemo(() => {
    if (!messages) return []
    const result: (ChatMessage & { isDateSeparator?: boolean; dateLabel?: string })[] = []
    let prevDate: Date | null = null

    messages.forEach((msg: ChatMessage) => {
      const msgDate = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt)
      if (shouldShowDateSeparator(prevDate, msgDate)) {
        result.push({
          id: `date-${msg.id}`,
          senderId: "",
          text: "",
          createdAt: msg.createdAt,
          isDateSeparator: true,
          dateLabel: formatDateSeparator(msgDate, locale, t),
        })
      }
      prevDate = msgDate
      result.push(msg)
    })

    return result
  }, [messages, locale, t])

  return (
    <PortalLayout>
      <div className={cn("max-w-3xl mx-auto space-y-4", isRTL ? "text-right" : "text-left")}>
        {/* Header Card */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(backPath)}
            className="gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0"
          >
            <ArrowRight size={16} className="ltr:rotate-180 rtl:rotate-0" />
            {t("chat_back_to_chats")}
          </Button>

          <div className="flex-1 min-w-0">
            <div className={cn("flex items-center gap-3", isRTL ? "flex-row-reverse" : "flex-row")}>
              {/* Partner Avatar */}
              <div className="shrink-0">
                <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10 flex items-center justify-center text-primary shadow-sm">
                  <span className="font-semibold text-sm">
                    {getInitials(partnerInfo?.partnerName || "")}
                  </span>
                </div>
              </div>

              {/* Partner Info */}
              <div className="min-w-0 flex-1">
                <div className={cn("flex items-center gap-2 flex-wrap", isRTL ? "flex-row-reverse" : "flex-row")}>
                  <h1 className="text-lg font-bold text-foreground truncate">
                    {partnerInfo?.partnerName || t("chat_partner")}
                  </h1>
                  {partnerInfo?.partnerCompany && (
                    <span className="text-xs text-muted-foreground truncate">
                      — {partnerInfo.partnerCompany}
                    </span>
                  )}
                </div>
                <div className={cn("flex items-center gap-2 mt-0.5 flex-wrap", isRTL ? "flex-row-reverse" : "flex-row")}>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-[10px] px-1.5 py-0 h-4 font-medium">
                    <Shield size={10} className="mr-0.5" />
                    {t("chat_accepted")}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-medium">
                    <Clock size={10} className="mr-0.5" />
                    {t("chat_private_channel")}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RFQ Context Card */}
        {chatMeta?.rfqTitle && (
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-sm", isRTL ? "flex-row-reverse" : "flex-row")}>
            <MessageSquare size={14} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground font-medium">{t("chat_contract_chat")}:</span>
            <span className="text-foreground font-semibold truncate">{chatMeta.rfqTitle}</span>
          </div>
        )}

        {/* Chat Window */}
        <Card className="border border-border/60 shadow-sm overflow-hidden flex flex-col bg-card" style={{ height: "65vh" }}>
          {/* Messages Area */}
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-muted/30 to-background/50">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="animate-spin" size={32} />
                  <p className="text-sm">{t("chat_list_loading")}</p>
                </div>
              </div>
            ) : !messages || messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3">
                <div className="h-16 w-16 rounded-2xl bg-primary/5 flex items-center justify-center">
                  <MessageSquare size={32} className="text-primary/30" />
                </div>
                <p className="font-bold text-foreground">{t("chat_start_chat")}</p>
                <p className="text-sm max-w-xs">{t("chat_start_chat_desc")}</p>
              </div>
            ) : (
              messagesWithDates.map((msg: any) => {
                if (msg.isDateSeparator) {
                  return (
                    <div key={msg.id} className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider px-2">
                        {msg.dateLabel}
                      </span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                  )
                }

                const isMine = msg.senderId === user?.uid
                return (
                  <div
                    key={msg.id}
                    className={cn("flex", isMine ? "justify-end" : "justify-start")}
                  >
                    <div className={cn("flex items-end gap-2 max-w-[80%]", isMine ? "flex-row-reverse" : "flex-row")}>
                      {/* Avatar for received messages */}
                      {!isMine && (
                        <div className="shrink-0 mb-1">
                          <div className="h-7 w-7 rounded-full bg-muted border border-border/50 flex items-center justify-center text-muted-foreground">
                            <User size={12} />
                          </div>
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div
                        className={cn(
                          "px-4 py-2.5 rounded-2xl shadow-sm transition-all",
                          isMine
                            ? "bg-primary text-primary-foreground rounded-tl-sm"
                            : "bg-card text-card-foreground rounded-tr-sm border border-border/80"
                        )}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                        <p
                          className={cn(
                            "text-[10px] mt-1",
                            isMine ? "text-primary-foreground/60" : "text-muted-foreground",
                            isRTL ? "text-left" : "text-right"
                          )}
                          suppressHydrationWarning
                        >
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </CardContent>

          {/* Input Area */}
          <div className="border-t border-border/60 bg-background/80 backdrop-blur-sm p-3">
            <div className={cn("flex items-end gap-2", isRTL ? "flex-row-reverse" : "flex-row")}>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("chat_send_placeholder")}
                className={cn(
                  "flex-1 rounded-2xl bg-muted border-none focus-visible:ring-1 focus-visible:ring-primary/30 px-4 py-3 min-h-[44px] max-h-[120px]",
                  isRTL ? "text-right" : "text-left"
                )}
                dir={isRTL ? 'rtl' : 'ltr'}
                disabled={sending}
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                size="icon"
                className={cn(
                  "shrink-0 rounded-full h-10 w-10 transition-all",
                  message.trim()
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}
