"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Send, Loader2, MessageSquare } from "lucide-react"
import { useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { 
  doc, getDoc, collection, addDoc, 
  query, orderBy
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"

export default function ChatPage() {
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

  // Load chat metadata
  useEffect(() => {
    if (!firestore || !chatId) return
    const chatRef = doc(firestore, "chats", chatId)
    getDoc(chatRef).then((snap) => {
      if (snap.exists()) {
        setChatMeta(snap.data())
      }
      setMetaLoading(false)
    })
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

  const handleSend = async () => {
    if (!message.trim() || !firestore || !user || !chatId) return
    setSending(true)
    try {
      await addDoc(collection(firestore, "chats", chatId, "messages"), {
        senderId: user.uid,
        text: message.trim(),
        createdAt: new Date().toISOString()  // client timestamp — always set immediately
      })
      setMessage("")
    } catch (err: any) {
      console.error("send message failed:", err?.code, err?.message)
      toast({ title: "خطأ", description: "فشل إرسال الرسالة", variant: "destructive" })
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

  const isLoading = isUserLoading || metaLoading || messagesLoading

  const formatTime = (ts: any) => {
    if (!ts) return ""
    // Handle both Firestore Timestamp and ISO string
    const d = ts?.toDate ? ts.toDate() : new Date(ts)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto text-right space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1 text-muted-foreground">
            <ArrowRight size={16} />
            العودة
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
                      className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm ${
                        isMine
                          ? "bg-primary text-white rounded-tr-sm"
                          : "bg-white text-slate-800 rounded-tl-sm border border-slate-100"
                      }`}
                    >
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      <p className={`text-[10px] mt-1 text-left ${isMine ? "text-white/60" : "text-muted-foreground"}`} suppressHydrationWarning>
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
