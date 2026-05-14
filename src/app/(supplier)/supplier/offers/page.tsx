"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { History, Eye, Clock, CheckCircle2, XCircle, MoreVertical, Loader2, Trash2, Calendar, Tag, DollarSign, MessageSquare, Phone, ArrowDown, Box, FileText, CircleDot, Check, AlertCircle } from "lucide-react"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, deleteDoc, doc, setDoc, getDoc, updateDoc, addDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function SupplierOffersPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const { toast } = useToast()
  const router = useRouter()
  const [viewOffer, setViewOffer] = useState<any | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [updatePriceOffer, setUpdatePriceOffer] = useState<any | null>(null)
  const [newPrice, setNewPrice] = useState("")
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false)
  const [confirmSampleOffer, setConfirmSampleOffer] = useState<any | null>(null)

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
      where("organizationId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading])

  const { data: rawOffers, isLoading: isCollectionLoading } = useCollection(offersQuery)
  const isLoading = isUserLoading || isCollectionLoading
  const offers = rawOffers
    ? [...rawOffers].sort((a: any, b: any) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
    : []

  // Stats
  const pendingCount = offers.filter((o: any) => o.status === "قيد المراجعة").length
  const acceptedCount = offers.filter((o: any) => o.status === "مقبول").length
  const rejectedCount = offers.filter((o: any) => o.status === "مرفوض").length

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول":   
        return (
          <Badge className="bg-success/10 text-success border-success/20 gap-1">
            <Check size={12} />مقبول
          </Badge>
        )
      case "مرفوض":  
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none gap-1">
            <XCircle size={12} />مرفوض
          </Badge>
        )
      case "مطلوب تخفيض": 
        return (
          <Badge className="bg-amber-100 text-amber-700 border-none gap-1">
            <AlertCircle size={12} />مطلوب تخفيض
          </Badge>
        )
      default:        
        return (
          <Badge className="bg-amber-50 text-amber-600 border-amber-100 gap-1">
            <CircleDot size={12} />قيد المراجعة
          </Badge>
        )
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

  const handleUpdatePrice = async () => {
    if (!firestore || !updatePriceOffer || !newPrice) return;
    setIsUpdatingPrice(true);
    try {
      await updateDoc(doc(firestore, "offers", updatePriceOffer.id), {
        price: newPrice,
        status: "قيد المراجعة",
        updatedAt: new Date().toISOString()
      });
      toast({ title: "تم التحديث", description: "تم تحديث السعر وإعادة إرسال العرض للمقاول." });
      setUpdatePriceOffer(null);
      setNewPrice("");
    } catch (error) {
      toast({ title: "خطأ", description: "فشل تحديث السعر، يرجى المحاولة مجدداً.", variant: "destructive" });
    } finally {
      setIsUpdatingPrice(false);
    }
  }

  const handleSampleAction = async (offerId: string, action: "تم الإرسال") => {
    if (!firestore || !user) return;
    setDeletingId(offerId); // Reusing deletingId as a loading state for this quick action
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        sampleStatus: action,
        sampleUpdatedAt: new Date().toISOString()
      });
      
      const offerSnap = await getDoc(doc(firestore, "offers", offerId));
      const offerData = offerSnap.data();
      if (offerData) {
        await addDoc(collection(firestore, "notifications"), {
          userId: offerData.contractorId,
          organizationId: offerData.contractorOrgId || offerData.contractorId,
          type: "sample_sent",
          title: "تم إرسال عينة",
          message: `قام المورد بإرسال العينة المطلوبة لمناقصة: ${offerData.rfqTitle}`,
          offerId: offerId,
          rfqId: offerData.rfqId,
          createdAt: new Date().toISOString(),
          read: false
        });
      }

      toast({ title: "تم تأكيد الإرسال", description: "تم إشعار المقاول بأنه تم إرسال العينة." });
      setConfirmSampleOffer(null);
      // Open chat dialog after sending
      setOpeningChat(offerId);
    } catch (error) {
      toast({ title: "خطأ", description: "حدث خطأ أثناء تحديث حالة العينة.", variant: "destructive" });
    } finally {
      setDeletingId(null);
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
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <FileText size={36} className="text-slate-300" />
                </div>
                <h3 className="font-semibold text-lg text-slate-700 mb-2">لا توجد عروض مقدمة</h3>
                <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                  لم تقم بتقديم أي عروض سعر بعد.تصفح المناقصات المتاحة وقدم عروضك الأولى!
                </p>
                <Link href="/supplier/rfqs">
                  <Button size="sm">تصفح المناقصات</Button>
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
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer: any) => (
                    <TableRow key={offer.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs hidden md:table-cell text-right">{offer.id.substring(0, 8)}</TableCell>
                      <TableCell className="font-bold text-right">{offer.rfqTitle || "مناقصة غير محددة"}</TableCell>
                      <TableCell className="font-bold text-right">
                        <div className="flex items-center justify-start gap-1">
                          <span className="text-primary font-bold">{offer.price ? `${offer.price}` : "غير متوفر"}</span>
                          {offer.price && <span className="text-xs text-muted-foreground">ر.س</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell text-right" suppressHydrationWarning>
                        {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString("ar-SA") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col gap-1 items-start">
                          {getStatusBadge(offer.status || "قيد المراجعة")}
                          {offer.sampleStatus && (
                            <Badge variant="outline" className={`text-[10px] ${
                              offer.sampleStatus === "مطلوبة" ? "border-blue-200 bg-blue-50 text-blue-700" :
                              offer.sampleStatus === "تم الإرسال" ? "border-amber-200 bg-amber-50 text-amber-700" :
                              "border-success/30 bg-success/10 text-success"
                            }`}>
                              العينة: {offer.sampleStatus}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-start gap-1">
                          {/* View Details */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-slate-100 hover text-secondary transition-colors cursor-pointer"
                            title="عرض التفاصيل"
                            onClick={() => setViewOffer(offer)}
                          >
                            <Eye size={16} />
                          </Button>

                          {/* Open Chat + WhatsApp for accepted offers */}
                          {offer.status === "مقبول" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hover:bg-primary/10 text-primary hover:text-primary transition-colors cursor-pointer"
                                title="فتح المحادثة مع المقاول"
                                onClick={() => openChat(offer)}
                                disabled={openingChat === offer.id}
                              >
                                {openingChat === offer.id
                                  ? <Loader2 size={16} className="animate-spin" />
                                  : <MessageSquare size={16} />}
                              </Button>
                              <ContractorWhatsAppButton contractorId={offer.contractorId} />
                            </>
                          )}

                          {/* Action for Price Reduction */}
                          {offer.status === "مطلوب تخفيض" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hover:bg-amber-100 text-amber-600 hover:text-amber-700 transition-colors cursor-pointer"
                              title="تحديث السعر"
                              onClick={() => { setUpdatePriceOffer(offer); setNewPrice(offer.price || ""); }}
                            >
                              <ArrowDown size={16} />
                            </Button>
                          )}

                          {/* Action for Sample Request */}
                          {offer.sampleStatus === "مطلوبة" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hover:bg-blue-100 text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                              title="تأكيد إرسال العينة"
                              onClick={() => setConfirmSampleOffer(offer)}
                              disabled={deletingId === offer.id}
                            >
                              {deletingId === offer.id ? <Loader2 size={16} className="animate-spin" /> : <Box size={16} />}
                            </Button>
                          )}

                          {/* More Actions */}
                          {offer.status === "قيد المراجعة" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="hover:bg-slate-100 transition-colors cursor-pointer">
                                  {deletingId === offer.id
                                    ? <Loader2 size={16} className="animate-spin" />
                                    : <MoreVertical size={16} />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-right" dir="rtl">
                                <DropdownMenuItem
                                  className="text-destructive cursor-pointer gap-2 focus:bg-destructive/10"
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
                  <p className="font-bold text-2xl text-primary">
                    {viewOffer.price} <span className="text-sm font-normal text-muted-foreground">ر.س</span>
                  </p>
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
              {viewOffer.offerPdfUrl && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-blue-600" />
                    <span className="text-sm font-bold text-slate-700">ملف العرض المرفق</span>
                  </div>
                  <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs">
                    <a href={viewOffer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                      عرض الملف
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOffer(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Update Price Dialog */}
      <Dialog open={!!updatePriceOffer} onOpenChange={(open) => !open && setUpdatePriceOffer(null)}>
        <DialogContent className="sm:max-w-md text-right" dir="rtl">
          <DialogHeader>
            <DialogTitle>تحديث سعر العرض</DialogTitle>
            <DialogDescription>
              طلب المقاول تخفيض السعر لهذا العرض. يرجى إدخال السعر الجديد أدناه لإعادة تقديمه.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>السعر السابق</Label>
              <div className="p-3 bg-slate-50 text-slate-500 rounded-md font-bold">
                {updatePriceOffer?.price} ر.س
              </div>
            </div>
            <div className="space-y-2">
              <Label>السعر الجديد (ر.س)</Label>
              <Input 
                type="number" 
                value={newPrice} 
                onChange={(e) => setNewPrice(e.target.value)} 
                placeholder="أدخل السعر المخفض"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdatePriceOffer(null)} disabled={isUpdatingPrice}>إلغاء</Button>
            <Button onClick={handleUpdatePrice} disabled={isUpdatingPrice || !newPrice || newPrice === updatePriceOffer?.price}>
              {isUpdatingPrice ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
              تأكيد السعر الجديد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Sample Sending Alert */}
      <AlertDialog open={!!confirmSampleOffer} onOpenChange={(open) => !open && setConfirmSampleOffer(null)}>
        <AlertDialogContent className="text-right" dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد إرسال العينة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد أنك قمت بإرسال العينة المطلوبة للمقاول للمناقصة "{confirmSampleOffer?.rfqTitle}"؟ 
              سيتم إشعار المقاول بذلك ليتمكن من تأكيد الاستلام.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse sm:justify-start">
            <AlertDialogCancel className="mt-0 sm:mt-0">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-white hover:bg-primary/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirmSampleOffer) {
                  handleSampleAction(confirmSampleOffer.id, "تم الإرسال");
                }
              }}
            >
              {deletingId === confirmSampleOffer?.id ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              نعم، تم الإرسال
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
        <AlertDialog open={!!openingChat} onOpenChange={(open) => { if (!open) setOpeningChat(null) }}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>تم إرسال العينة بنجاح!</AlertDialogTitle>
              <AlertDialogDescription>
                هل ترغب في فتح محادثة مع المقاول لمتابعة وصول العينة؟
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex gap-2">
              <AlertDialogCancel onClick={() => setOpeningChat(null)}>لاحقاً</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                const id = openingChat;
                setOpeningChat(null);
                router.push(`/chat/${id}`);
              }}>
                فتح المحادثة
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AlertDialog>
    </PortalLayout>
  )
}

function ContractorWhatsAppButton({ contractorId }: { contractorId?: string }) {
  const firestore = useFirestore()
  const docRef = useMemoFirebase(() => {
    if (!firestore || !contractorId) return null
    return doc(firestore, "users", contractorId)
  }, [firestore, contractorId])
  const { data: contractor } = useDoc(docRef)

  const phone = contractor?.phone || contractor?.mobile || contractor?.whatsapp
  if (!phone) return null

  const cleaned = phone.replace(/\D/g, "")
  const waNumber = cleaned.startsWith("0") ? "966" + cleaned.slice(1) : cleaned

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      title="واتسآب المقاول"
      className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-[#25D366]/10 text-[#25D366] transition-colors"
    >
      <Phone size={16} />
    </a>
  )
}
