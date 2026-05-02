
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { History, Eye, Clock, CheckCircle2, XCircle, MoreVertical } from "lucide-react"

import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"

export default function SupplierOffersPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

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

  // Calculate stats
  const pendingCount = offers.filter(o => o.status === "قيد المراجعة" || o.status === "New").length
  const acceptedCount = offers.filter(o => o.status === "مقبول" || o.status === "Accepted").length
  const rejectedCount = offers.filter(o => o.status === "مرفوض" || o.status === "Rejected").length

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">مقبول</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">مرفوض</Badge>
      case "قيد المراجعة": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">عروضي المقدمة</h1>
          <p className="text-muted-foreground mt-1">تتبع حالة عروض السعر التي قمت بتقديمها للمقاولين</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
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

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="text-primary" size={20} />
              سجل العروض
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-10 flex justify-center text-muted-foreground">جاري تحميل العروض...</div>
            ) : offers.length === 0 ? (
              <div className="p-10 flex flex-col items-center text-center text-muted-foreground space-y-2">
                <History size={48} className="opacity-20 mb-2" />
                <p>لا توجد عروض مقدمة حتى الآن.</p>
                <p className="text-sm">تصفح المناقصات المتاحة وقدم عرضك الأول!</p>
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
                      <TableCell className="text-primary font-bold">{offer.price || "غير متوفر"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell" suppressHydrationWarning>
                        {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('ar-SA') : "-"}
                      </TableCell>
                      <TableCell>{getStatusBadge(offer.status || "قيد المراجعة")}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon">
                            <Eye size={16} />
                          </Button>
                          <Button variant="ghost" size="icon">
                            <MoreVertical size={16} />
                          </Button>
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
    </PortalLayout>
  )
}
