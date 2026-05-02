"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, PlusCircle, Eye, Calendar, Loader2 } from "lucide-react"
import Link from "next/link"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
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

  const { data: rfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || isCollectionLoading

  const filteredRfqs = rfqs?.filter((rfq: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rfq.title?.toLowerCase().includes(q) ||
      rfq.categoryId?.toLowerCase().includes(q) ||
      rfq.id?.toLowerCase().includes(q)
    );
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "New": return <Badge className="bg-success/10 text-success border-success/20">جديد</Badge>
      case "Awarded": return <Badge className="bg-blue-50 text-blue-600">تمت الترسية</Badge>
      case "Completed": return <Badge className="bg-slate-50 text-slate-600">مكتمل</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
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
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>جاري تحميل البيانات...</p>
              </div>
            ) : filteredRfqs.length === 0 ? (
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
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
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
                  {filteredRfqs.map((rfq: any) => (
                    <TableRow key={rfq.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-bold">{rfq.title}</TableCell>
                      <TableCell>{rfq.categoryId}</TableCell>
                      <TableCell>{getStatusBadge(rfq.status)}</TableCell>
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
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}