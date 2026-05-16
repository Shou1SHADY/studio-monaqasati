"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Send, Loader2, MessageSquare } from "lucide-react"
import { useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import {
  doc, getDoc, collection, addDoc, updateDoc,
  query, orderBy
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"

interface ChatPageContentProps {
  backPath: string
}


export default function ChatPageContent({ backPath }: ChatPageContentProps) {
  const params = useParams()
  const chatId = params.chatId as string
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [chatMeta, setChatMeta] = useState<any>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load chat metadata(one-time get; real-time not needed for meta)
  useEffect(() => {
    if (!firestore || !chatId) return
    getDoc(doc(firestore, "chats", chatId)).then((snap) => {
      if (snap.exists()) setChatMeta({ id: snap.id, ...snap.data() })
      setMetaLoading(false)
    }).catch(() => setMetaLoading(false))
  }, [firestore, chatId])

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Mark chat as read when opened — remove current user's UID from unreadFor
  useEffect(() => {
    if (!firestore || !chatId || !user || metaLoading || !chatMeta) return
    const unreadFor: string[] = chatMeta.unreadFor || []
    if (unreadFor.includes(user.uid)) {
      updateDoc(doc(firestore, "chats", chatId), {
        unreadFor: unreadFor.filter((uid: string) => uid !== user.uid)
      }).catch(() => { })
    }
  }, [firestore, chatId, user, chatMeta, metaLoading])

  const handleSend = async () => {
    if (!message.trim() || !firestore || !user || !chatId || !chatMeta) return
    setSending(true)
    const msgText = message.trim()
    setMessage("") // optimistic clear
    try {
      // Determine the other party's UID
      const otherId = chatMeta.contractorId === user.uid
        ? chatMeta.supplierId
        : chatMeta.contractorId

      // Write message
      await addDoc(collection(firestore, "chats", chatId, "messages"), {
        senderId: user.uid,
        text: msgText,
        createdAt: new Date().toISOString()
      })

      // Update chat doc with last message preview and mark unread for other party
      const currentUnread: string[] = chatMeta.unreadFor || []
      const newUnread = otherId && !currentUnread.includes(otherId)
        ? [...currentUnread, otherId]
        : currentUnread

      await updateDoc(doc(firestore, "chats", chatId), {
        lastMessage: msgText,
        lastMessageAt: new Date().toISOString(),
        unreadFor: newUnread
      })

      // Also write a notification to the other user's sub-collection for the bell icon
      if (otherId) {
        await addDoc(
          collection(firestore, "users", otherId, "notifications"),
          {
            type: "new_chat_message",
            title: "رسالة جديدة",
            message: msgText.length > 80 ? msgText.substring(0, 80) + "..." : msgText,
            chatId: chatId,
            rfqTitle: chatMeta.rfqTitle || "",
            createdAt: new Date().toISOString(),
            read: false
          }
        ).catch(() => { }) // non-blocking — unread dot on chat is the primary signal
      }

      // Refresh local chatMeta to reflect updated unreadFor
      setChatMeta((prev: any) => prev ? { ...prev, unreadFor: newUnread } : prev)

    } catch (err: any) {
      console.error("send message failed:", err?.code, err?.message)
      toast({ title: "خطأ", description: "فشل إرسال الرسالة", variant: "destructive" })
      setMessage(msgText) // restore on error
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
    return d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
  }

  const isLoading = isUserLoading || metaLoading || messagesLoading

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto text-right space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(backPath)}
            className="gap-1 text-muted-foreground"
          >
            <ArrowRight size={16} />
            العودة للمحادثات
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <MessageSquare size={18} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-secondary">
                  {chatMeta?.rfqTitle || "محادثة العقد"}
                </h1>
                <div className="flex items-center gap-2">
                  <Badge className="bg-success/10 text-success border-success/20 text-xs">مقبول ✅</Badge>
                  <span className="text-xs text-muted-foreground">قناة تواصل خاصة</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Window */}
        <Card className="border-none shadow-md overflow-hidden flex flex-col" style={{ height: "65vh" }}>
          {/* Messages Area */}
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="animate-spin text-muted-foreground" size={32} />
              </div>
            ) : !messages || messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3">
                <MessageSquare size={40} className="opacity-20" />
                <p className="font-bold">ابدأ المحادثة</p>
                <p className="text-sm">أرسل رسالتك الأولى للبدء في التواصل مع الطرف الآخر.</p>
              </div>
            ) : (
              messages.map((msg: any) => {
                const isMine = msg.senderId === user?.uid
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm ${isMine
                          ? "bg-primary text-white rounded-tr-sm"
                          : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"
                        }`}
                    >
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      <p
                        className={`text-[10px] mt-1 text-left ${isMine ? "text-white/60" : "text-muted-foreground"}`}
                        suppressHydrationWarning
                      >
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </CardContent>

          {/* Input Area */}
          <div className="border-t bg-white p-3 flex items-center gap-2">
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              size="icon"
              className="shrink-0 rounded-full h-10 w-10"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب رسالتك... (Enter للإرسال)"
              className="flex-1 rounded-full bg-slate-50 border-none focus-visible:ring-1 text-right"
              dir="rtl"
              disabled={sending}
            />
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}
