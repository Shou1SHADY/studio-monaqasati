"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  FileText, 
  Search, 
  Filter, 
  Calendar,
  MoreVertical,
  Activity,
  CheckCircle,
  Clock,
  Loader2
} from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, orderBy } from "firebase/firestore"

export default function AdminRfqsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), orderBy("createdAt", "desc"))
  }, [firestore, user, isUserLoading])

  const { data: rfqs, isLoading: isCollectionLoading } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || isCollectionLoading

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "New": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "Awarded": return <Badge className="bg-blue-50 text-blue-600">تمت الترسية</Badge>
      case "Completed": return <Badge className="bg-slate-50 text-slate-600">مكتمل</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة المناقصات</h1>
            <p className="text-muted-foreground mt-1">مراقبة كافة المناقصات المطروحة على المنصة</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="بحث في المناقصات..." className="pr-10" />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              كافة الطلبات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>جاري تحميل البيانات...</p>
              </div>
            ) : !rfqs || rfqs.length === 0 ? (
              <div className="p-20 text-center text-muted-foreground">لا توجد مناقصات حالياً.</div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right">المعرف</TableHead>
                    <TableHead className="text-right">المناقصة</TableHead>
                    <TableHead className="text-right">الفئة</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rfqs.map((rfq) => (
                    <TableRow key={rfq.id}>
                      <TableCell className="font-mono text-xs">{rfq.id}</TableCell>
                      <TableCell className="font-bold">{rfq.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">{rfq.categoryId}</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar size={14} />
                          {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString('ar-SA') : '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-left">
                        <Button variant="ghost" size="icon">
                          <MoreVertical size={18} />
                        </Button>
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