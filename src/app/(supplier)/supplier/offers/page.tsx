"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { History, Eye, Clock, CheckCircle2, XCircle, MoreVertical, Loader2, Trash2, Calendar, Tag, DollarSign, MessageSquare } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, deleteDoc, doc, setDoc, getDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function SupplierOffersPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const router = useRouter()
  const [viewOffer, setViewOffer] = useState<any | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)

  const openChat = async (offer: any) => {
    if (!user) return
    // The chat document is created automatically when the contractor accepts.
    // Just navigate to the chat page — it will show empty state if not created yet.
    router.push(`/chat/${offer.id}`)
  }

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("supplierId", "==", user.uid),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading])

  const { data: offersData, isLoading: isCollectionLoading } = useCollection(offersQuery)
  const isLoading = isUserLoading || isCollectionLoading
  const offers = offersData || []

  // Stats
  const pendingCount = offers.filter((o: any) => o.status === "قيد المراجعة").length
  const acceptedCount = offers.filter((o: any) => o.status === "مقبول").length
  const rejectedCount = offers.filter((o: any) => o.status === "مرفوض").length

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول":   return <Badge className="bg-success/10 text-success border-success/20">مقبول ✅</Badge>
      case "مرفوض":  return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض ❌</Badge>
      default:        return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة ⏳</Badge>
    }
  }

  const handleWithdraw = async (offerId: string) => {
    if (!firestore) return
    setDeletingId(offerId)
    try {
      await deleteDoc(doc(firestore, "offers", offerId))
      toast({ title: "تم سحب العرض", description: "تم حذف عرضك بنجاح." })
    } catch {
      toast({ title: "خطأ", description: "فشل سحب العرض، حاول مجدداً.", variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">عروضي المقدمة</h1>
          <p className="text-muted-foreground mt-1">تتبع حالة عروض السعر التي قمت بتقديمها للمقاولين</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض معلقة</p>
                <p className="text-xl font-bold text-slate-800">{pendingCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض مقبولة</p>
                <p className="text-xl font-bold text-slate-800">{acceptedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <XCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عروض مرفوضة</p>
                <p className="text-xl font-bold text-slate-800">{rejectedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="text-primary" size={20} />
              سجل العروض
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="animate-spin" size={36} />
                <p>جاري تحميل العروض...</p>
              </div>
            ) : offers.length === 0 ? (
              <div className="p-10 flex flex-col items-center text-center text-muted-foreground space-y-3">
                <History size={48} className="opacity-20 mb-2" />
                <p>لا توجد عروض مقدمة حتى الآن.</p>
                <p className="text-sm">تصفح المناقصات المتاحة وقدم عرضك الأول!</p>
                <Link href="/supplier/rfqs">
                  <Button size="sm" className="mt-1">تصفح المناقصات</Button>
                </Link>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right hidden md:table-cell">المعرف</TableHead>
                    <TableHead className="text-right">المناقصة</TableHead>
                    <TableHead className="text-right">السعر</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">التاريخ</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer: any) => (
                    <TableRow key={offer.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs hidden md:table-cell">{offer.id.substring(0, 8)}</TableCell>
                      <TableCell className="font-bold">{offer.rfqTitle || "مناقصة غير محددة"}</TableCell>
                      <TableCell className="text-primary font-bold">{offer.price ? `${offer.price} ر.س` : "غير متوفر"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell" suppressHydrationWarning>
                        {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString("ar-SA") : "-"}
                      </TableCell>
                      <TableCell>{getStatusBadge(offer.status || "قيد المراجعة")}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-1">
                          {/* View Details */}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="عرض التفاصيل"
                            onClick={() => setViewOffer(offer)}
                          >
                            <Eye size={16} />
                          </Button>

                          {/* Open Chat for accepted offers */}
                          {offer.status === "مقبول" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="فتح المحادثة مع المقاول"
                              onClick={() => openChat(offer)}
                              disabled={openingChat === offer.id}
                              className="text-primary"
                            >
                              {openingChat === offer.id
                                ? <Loader2 size={16} className="animate-spin" />
                                : <MessageSquare size={16} />}
                            </Button>
                          )}

                          {/* More Actions */}
                          {offer.status === "قيد المراجعة" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  {deletingId === offer.id
                                    ? <Loader2 size={16} className="animate-spin" />
                                    : <MoreVertical size={16} />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-right" dir="rtl">
                                <DropdownMenuItem
                                  className="text-destructive cursor-pointer gap-2"
                                  onClick={() => handleWithdraw(offer.id)}
                                >
                                  <Trash2 size={14} />
                                  سحب العرض
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Offer Detail Dialog */}
      <Dialog open={!!viewOffer} onOpenChange={(open) => !open && setViewOffer(null)}>
        <DialogContent className="sm:max-w-md text-right" dir="rtl">
          <DialogHeader>
            <DialogTitle>تفاصيل العرض</DialogTitle>
            <DialogDescription>معلومات عرض السعر المقدم</DialogDescription>
          </DialogHeader>
          {viewOffer && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <span className="text-muted-foreground text-sm">حالة العرض</span>
                {getStatusBadge(viewOffer.status || "قيد المراجعة")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-primary/5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <DollarSign size={12} />
                    السعر المقدم
                  </div>
                  <p className="font-bold text-lg text-primary">{viewOffer.price} ر.س</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar size={12} />
                    تاريخ التقديم
                  </div>
                  <p className="font-bold text-sm" suppressHydrationWarning>
                    {viewOffer.createdAt ? new Date(viewOffer.createdAt).toLocaleDateString("ar-SA") : "-"}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Tag size={12} />
                  المناقصة
                </div>
                <p className="font-bold">{viewOffer.rfqTitle || "مناقصة غير محددة"}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground">معرف العرض</p>
                <p className="font-mono text-xs text-slate-500">{viewOffer.id}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOffer(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}
