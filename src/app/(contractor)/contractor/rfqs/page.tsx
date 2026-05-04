"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, PlusCircle, Eye, Calendar, Loader2 } from "lucide-react"
import Link from "next/link"
import { useCollectionPaginated, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"
import { useSearchParams } from "next/navigation"

export default function ContractorRfqsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

  // الإصلاح: منع إرسال الاستعلام حتى يكتمل تحميل حالة المستخدم من Firebase Auth
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    
    return query(
      collection(firestore, "rfqs"),
      where("contractorId", "==", user.uid),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading])

  const { data: rfqs, isLoading: isCollectionLoading, hasMore, loadMore } = useCollectionPaginated(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs)
  const isLoadingMore = isCollectionLoading && !!rfqs

  const filteredRfqs = rfqs?.filter((rfq: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rfq.title?.toLowerCase().includes(q) ||
      rfq.category?.toLowerCase().includes(q) ||
      rfq.subCategory?.toLowerCase().includes(q) ||
      rfq.id?.toLowerCase().includes(q)
    );
  }) || [];

  const getStatusBadge = (rfq: any) => {
    if (rfq.status === "Awarded") {
      return <Badge className="bg-success/10 text-success border-success/20 font-bold">تمت الترسية 🏆</Badge>;
    }
    
    if (rfq.deadline) {
      const deadlineDate = new Date(rfq.deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day for accurate comparison
      if (deadlineDate < today) {
        return <Badge className="bg-destructive/10 text-destructive border-none font-bold">منتهية الصلاحية ⏱️</Badge>;
      }
    }
    
    return <Badge className="bg-blue-50 text-blue-600 border-none font-bold">مفتوحة للتقديم 🟢</Badge>;
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">مناقصاتي</h1>
            <p className="text-muted-foreground mt-1">إدارة ومتابعة طلبات عروض السعر الخاصة بك</p>
          </div>
          <Link href="/contractor/rfqs/new">
            <Button className="w-full sm:w-auto gap-2">
              <PlusCircle size={18} />
              طرح مناقصة جديدة
            </Button>
          </Link>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              قائمة المناقصات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading && (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>جاري تحميل البيانات...</p>
              </div>
            )}
            {!isLoading && (!rfqs || rfqs.length === 0) && (
              <div className="p-20 text-center space-y-4">
                <p className="text-muted-foreground">
                  {searchQuery ? "لا توجد مناقصات مطابقة لبحثك." : "لا توجد مناقصات حالية."}
                </p>
                {!searchQuery && (
                  <Link href="/contractor/rfqs/new">
                    <Button variant="outline">اطرح أول مناقصة الآن</Button>
                  </Link>
                )}
              </div>
            )}
            {!isLoading && rfqs && rfqs.length > 0 && (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right">العنوان</TableHead>
                    <TableHead className="text-right">الفئة</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">التاريخ</TableHead>
                    <TableHead className="text-right hidden md:table-cell">الكمية</TableHead>
                    <TableHead className="text-left">عروض / إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rfqs || []).filter((rfq: any) => {
                    if (!searchQuery) return true;
                    const q = searchQuery.toLowerCase();
                    return (
                      rfq.title?.toLowerCase().includes(q) ||
                      rfq.category?.toLowerCase().includes(q) ||
                      rfq.subCategory?.toLowerCase().includes(q) ||
                      rfq.id?.toLowerCase().includes(q)
                    );
                  }).map((rfq: any) => (
                      <TableRow key={rfq.id} className="hover:bg-muted/50">
                      <TableCell className="font-bold">{rfq.title}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{rfq.category}</span>
                          <span className="text-xs text-muted-foreground">{rfq.subCategory}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(rfq)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
                          <Calendar size={14} />
                          {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString('ar-SA') : '-'}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="font-bold">{rfq.quantity} {rfq.unitOfMeasure}</span>
                      </TableCell>
                      <TableCell className="text-left">
                        <Link href={`/contractor/rfqs/${rfq.id}/offers`}>
                          <Button variant="outline" size="sm" className="gap-1 text-primary border-primary/30 hover:bg-primary/5">
                            <Eye size={14} />
                            عروض
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {hasMore && (
                  <div className="p-4 text-center">
                    <Button 
                      onClick={loadMore} 
                      disabled={isLoadingMore}
                      variant="outline"
                      className="font-bold"
                    >
                      {isLoadingMore && <Loader2 className="animate-spin ml-2" size={16} />}
                      تحميل المزيد
                    </Button>
                  </div>
                )}
              </Table>
            )}
        </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}