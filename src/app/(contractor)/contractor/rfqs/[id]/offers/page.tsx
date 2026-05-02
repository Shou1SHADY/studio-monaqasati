"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ArrowRight,
  TrendingUp,
  User,
  Calendar,
  MessageSquare
} from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc, setDoc, getDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

export default function RfqOffersPage() {
  const params = useParams()
  const rfqId = params.id as string
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)

  const openChat = async (offer: any) => {
    if (!firestore || !user) return
    setOpeningChat(offer.id)
    try {
      // Create chat doc if it doesn't exist (fallback for offers accepted before this fix)
      const chatRef = doc(firestore, "chats", offer.id)
      const snap = await getDoc(chatRef)
      if (!snap.exists()) {
        await setDoc(chatRef, {
          offerId: offer.id,
          rfqId: rfqId,
          rfqTitle: offer.rfqTitle || offer.title || "",
          contractorId: user.uid,
          supplierId: offer.supplierId,
          createdAt: new Date().toISOString()
        })
      }
      router.push(`/chat/${offer.id}`)
    } catch (err: any) {
      console.error("❌ openChat failed:", err?.code, err?.message)
      toast({ title: "خطأ", description: "تعذر فتح المحادثة: " + (err?.code || ""), variant: "destructive" })
      setOpeningChat(null)
    }
  }

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "==", rfqId),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading, rfqId])

  const { data: offers, isLoading } = useCollection(offersQuery)

  const handleDecision = async (offerId: string, decision: "مقبول" | "مرفوض") => {
    if (!firestore || !user) return
    setProcessingId(offerId)

    const offer = offers?.find((o: any) => o.id === offerId)

    // Step 1: Update offer status
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        status: decision,
        decidedAt: new Date().toISOString()
      })
    } catch (error: any) {
      console.error("❌ updateDoc offer failed:", error?.code, error?.message)
      toast({ title: "خطأ", description: `فشل تحديث العرض: ${error?.code || error?.message}`, variant: "destructive" })
      setProcessingId(null)
      return
    }

    // Step 2: Auto-create chat when accepting
    if (decision === "مقبول" && offer) {
      try {
        const chatRef = doc(firestore, "chats", offerId)
        const snap = await getDoc(chatRef)
        if (!snap.exists()) {
          await setDoc(chatRef, {
            offerId: offerId,
            rfqId: rfqId,
            rfqTitle: offer.rfqTitle || offer.title || "",
            contractorId: user.uid,
            supplierId: offer.supplierId,
            createdAt: new Date().toISOString()
          })
        }
      } catch (error: any) {
        console.error("❌ setDoc chat failed:", error?.code, error?.message)
        // Don't block the accept flow — offer is already updated
        toast({ title: "تنبيه", description: "تم قبول العرض لكن فشل إنشاء المحادثة. تحقق من قواعد Firestore.", variant: "destructive" })
        setProcessingId(null)
        return
      }
    }

    toast({
      title: decision === "مقبول" ? "✅ تم قبول العرض!" : "❌ تم رفض العرض",
      description: decision === "مقبول"
        ? "سيتم إشعار المورد. يمكنك التواصل معه من صفحة محادثاتي."
        : "تم رفض العرض وسيتم إشعار المورد.",
    })
    setProcessingId(null)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">مقبول ✅</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض ❌</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة 🕐</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 gap-1 text-muted-foreground">
              <ArrowRight size={16} />
              العودة للمناقصات
            </Button>
            <h1 className="text-3xl font-bold text-secondary font-headline">عروض المناقصة</h1>
            <p className="text-muted-foreground mt-1">راجع عروض الأسعار المقدمة من الموردين واتخذ قرارك</p>
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-right">
            <p className="text-xs text-muted-foreground">رقم المناقصة</p>
            <p className="font-mono text-sm font-bold text-primary">{rfqId.substring(0, 12)}...</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <TrendingUp size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي العروض</p>
                <p className="text-xl font-bold">{offers?.length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تم قبولها</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "مقبول").length || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                <Loader2 size={18} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قيد المراجعة</p>
                <p className="text-xl font-bold">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Offers List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل العروض...</p>
            </div>
          ) : !offers || offers.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <TrendingUp size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد عروض حتى الآن</p>
                <p className="text-sm">عندما يقدم الموردون عروضهم لهذه المناقصة، ستظهر هنا تلقائياً.</p>
              </CardContent>
            </Card>
          ) : (
            offers.map((offer: any) => (
              <Card key={offer.id} className={`border-none shadow-sm hover:shadow-md transition-all overflow-hidden ${
                offer.status === "مقبول" ? "ring-1 ring-success/30 bg-success/5" : 
                offer.status === "مرفوض" ? "opacity-60" : "bg-white"
              }`}>
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    {/* Offer Details */}
                    <div className="p-6 flex-1 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                            <User size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-sm text-slate-800">مورد مسجل</p>
                            <p className="text-xs text-muted-foreground font-mono">{offer.supplierId?.substring(0, 10)}...</p>
                          </div>
                        </div>
                        {getStatusBadge(offer.status || "قيد المراجعة")}
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2 bg-primary/5 px-4 py-2 rounded-lg">
                          <span className="text-muted-foreground">السعر المقترح:</span>
                          <span className="font-bold text-xl text-primary">{offer.price} <span className="text-sm font-normal">ر.س</span></span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={14} />
                          <span>{offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('ar-SA') : "-"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons - Pending */}
                    {offer.status === "قيد المراجعة" && (
                      <div className="bg-slate-50/70 p-6 flex flex-row md:flex-col items-center justify-center gap-3 md:border-r border-t md:border-t-0 min-w-[180px]">
                        <Button
                          onClick={() => handleDecision(offer.id, "مقبول")}
                          disabled={processingId === offer.id}
                          className="w-full bg-success hover:bg-success/90 gap-2 rounded-full"
                          size="sm"
                        >
                          {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          قبول العرض
                        </Button>
                        <Button
                          onClick={() => handleDecision(offer.id, "مرفوض")}
                          disabled={processingId === offer.id}
                          variant="outline"
                          className="w-full gap-2 rounded-full text-destructive border-destructive/30 hover:bg-destructive/5"
                          size="sm"
                        >
                          <XCircle size={14} />
                          رفض
                        </Button>
                      </div>
                    )}

                    {/* Chat Button - Accepted */}
                    {offer.status === "مقبول" && (
                      <div className="bg-success/5 p-6 flex items-center justify-center md:border-r border-t md:border-t-0 min-w-[180px]">
                        <Button
                          onClick={() => openChat(offer)}
                          disabled={openingChat === offer.id}
                          className="w-full bg-primary hover:bg-primary/90 gap-2 rounded-full"
                          size="sm"
                        >
                          {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                          فتح المحادثة
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
