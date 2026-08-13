"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Send, Loader2, MessageSquare, Users } from "lucide-react"
import { useFirestore, useUser, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import {
  doc, setDoc, getDoc, collection, addDoc, updateDoc, serverTimestamp,
  query, orderBy, where, getDocs, writeBatch,
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"

interface TeamChatMessage {
  id: string
  senderId: string
  senderName: string
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
  return date.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { weekday: "long", month: "short", day: "numeric" })
}

function shouldShowDateSeparator(prev: Date | null, curr: Date) {
  if (!prev) return true
  return prev.toDateString() !== curr.toDateString()
}

export function TeamChatPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRTL = locale === "ar"
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const userDocRef = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user])
  const { data: profile, isLoading: profileLoading } = useDoc(userDocRef)
  const organizationId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || null

  const messagesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "teamChats", organizationId, "messages"), orderBy("createdAt", "asc"))
  }, [firestore, organizationId])
  const { data: messages, isLoading: messagesLoading } = useCollection(messagesQuery)

  // Org member list, so a new message can fan out a notification to everyone else
  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: members } = useCollection(membersQuery)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Reset this member's unread badge for the channel on open
  useEffect(() => {
    if (!firestore || !organizationId || !user) return
    getDocs(query(
      collection(firestore, "users", user.uid, "notifications"),
      where("type", "==", "team_chat_message"),
      where("read", "==", false)
    )).then((snap) => {
      if (snap.empty) return
      const batch = writeBatch(firestore)
      snap.docs.forEach((d) => batch.update(d.ref, { read: true }))
      return batch.commit()
    }).catch(() => { })
  }, [firestore, organizationId, user])

  const handleSend = async () => {
    if (!message.trim() || !firestore || !user || !organizationId) return
    setSending(true)
    const msgText = message.trim()
    setMessage("")
    const senderName = (profile as { name?: string } | null)?.name || user.email || t("chat_you")
    try {
      const chatSnap = await getDoc(doc(firestore, "teamChats", organizationId))
      if (!chatSnap.exists()) {
        await setDoc(doc(firestore, "teamChats", organizationId), {
          organizationId,
          createdAt: serverTimestamp(),
        })
      }

      await addDoc(collection(firestore, "teamChats", organizationId, "messages"), {
        senderId: user.uid,
        senderName,
        text: msgText,
        createdAt: serverTimestamp(),
      })

      updateDoc(doc(firestore, "teamChats", organizationId), {
        lastMessage: msgText,
        lastMessageAt: serverTimestamp(),
      }).catch(() => { })

      const others = (members || []).filter((m: any) => m.id !== user.uid)
      if (others.length > 0) {
        const batch = writeBatch(firestore)
        others.forEach((m: any) => {
          const notifRef = doc(collection(firestore, "users", m.id, "notifications"))
          batch.set(notifRef, {
            type: "team_chat_message",
            title: senderName,
            message: msgText.length > 80 ? msgText.substring(0, 80) + "..." : msgText,
            organizationId,
            createdAt: new Date().toISOString(),
            read: false,
          })
        })
        batch.commit().catch(() => { })
      }
    } catch (err: any) {
      console.error("team chat send failed:", err?.code, err?.message)
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
    return d.toLocaleTimeString(locale === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })
  }

  const isLoading = isUserLoading || profileLoading || messagesLoading

  const messagesWithDates = useMemo(() => {
    if (!messages) return []
    const result: (TeamChatMessage & { isDateSeparator?: boolean; dateLabel?: string })[] = []
    let prevDate: Date | null = null
    ;(messages as TeamChatMessage[]).forEach((msg) => {
      const msgDate = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt)
      if (shouldShowDateSeparator(prevDate, msgDate)) {
        result.push({
          id: `date-${msg.id}`,
          senderId: "",
          senderName: "",
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
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10 flex items-center justify-center text-primary shadow-sm shrink-0">
            <Users size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-foreground truncate">{t("team_chat_title")}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-medium">
                {t("team_chat_member_count", { count: (members || []).length })}
              </Badge>
            </div>
          </div>
        </div>

        <Card className="border border-border/60 shadow-sm overflow-hidden flex flex-col bg-card" style={{ height: "65vh" }}>
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
                <p className="font-bold text-foreground">{t("team_chat_empty_title")}</p>
                <p className="text-sm max-w-xs">{t("team_chat_empty_desc")}</p>
              </div>
            ) : (
              messagesWithDates.map((msg) => {
                if (msg.isDateSeparator) {
                  return (
                    <div key={msg.id} className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider px-2">{msg.dateLabel}</span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                  )
                }
                const isMine = msg.senderId === user?.uid
                return (
                  <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                    <div className={cn("flex items-end gap-2 max-w-[80%]", isMine ? "flex-row-reverse" : "flex-row")}>
                      {!isMine && (
                        <div className="shrink-0 mb-1">
                          <div className="h-7 w-7 rounded-full bg-muted border border-border/50 flex items-center justify-center text-muted-foreground text-[10px] font-bold">
                            {getInitials(msg.senderName)}
                          </div>
                        </div>
                      )}
                      <div
                        className={cn(
                          "px-4 py-2.5 rounded-2xl shadow-sm transition-all",
                          isMine ? "bg-primary text-primary-foreground rounded-tl-sm" : "bg-card text-card-foreground rounded-tr-sm border border-border/80"
                        )}
                      >
                        {!isMine && <p className="text-[11px] font-bold text-primary mb-0.5">{msg.senderName}</p>}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                        <p
                          className={cn("text-[10px] mt-1", isMine ? "text-primary-foreground/60" : "text-muted-foreground", isRTL ? "text-left" : "text-right")}
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
                dir={isRTL ? "rtl" : "ltr"}
                disabled={sending}
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                size="icon"
                className={cn(
                  "shrink-0 rounded-full h-10 w-10 transition-all",
                  message.trim() ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground"
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
