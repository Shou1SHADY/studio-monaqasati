 
"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  Users, 
  Search, 
  ShieldCheck, 
  ShieldAlert, 
  MoreVertical,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2
} from "lucide-react"
import { useFirestore, useCollection } from "@/firebase"
import { collection, query, where, updateDoc, doc, limit } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"

export default function AdminSuppliersPage() {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [limitCount, setLimitCount] = useState(20)
  
  const suppliersQuery = query(
    collection(firestore!, "users"),
    where("role", "==", "Supplier"),
    limit(limitCount)
  )
  const { data: suppliers, isLoading } = useCollection(suppliersQuery)
  const [localSuppliers, setLocalSuppliers] = useState<any[]>([])

  useEffect(() => {
    if (suppliers) {
      setLocalSuppliers(suppliers.map((s: any) => ({
        id: s.id,
        name: s.name || "غير محدد",
        contact: s.phone || "غير محدد",
        category: s.specializations?.[0] || "غير محدد",
        verified: s.isVerified || false,
        verificationRequested: s.verificationRequested || false,
        status: s.isVerified ? "نشط" : s.verificationRequested ? "بانتظار التوثيق" : "قيد المراجعة",
        hasCr: !!s.crNumber,
        hasCerts: (s.certificates?.length || 0) > 0
      })))
    }
  }, [suppliers])

  const handleVerify = async (id: string, verify: boolean) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "users", id), {
        isVerified: verify,
        verificationRequested: false
      })
      setLocalSuppliers(prev => prev.map(s => s.id === id ? { ...s, verified: verify, verificationRequested: false, status: verify ? "نشط" : "قيد المراجعة" } : s))
      toast({ title: verify ? "تم التوثيق" : "تم إلغاء التوثيق", description: "تم تحديث حالة المورد بنجاح" })
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "نشط": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "قيد المراجعة": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">قيد المراجعة</Badge>
      case "موقوف": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">موقوف</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const filteredSuppliers = localSuppliers.filter(s => 
    s.name.includes(searchQuery) || s.contact.includes(searchQuery)
  )

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة الموردين</h1>
            <p className="text-muted-foreground mt-1">التحقق من الموردين الجدد وإدارة حساباتهم</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="بحث باسم المورد..." 
                className="pr-10" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2 shrink-0">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm bg-blue-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <Users size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الموردين</p>
                <p className="text-2xl font-bold">{localSuppliers.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-success/5">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ShieldCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">موثقين</p>
                <p className="text-2xl font-bold">{localSuppliers.filter(s => s.verified).length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-amber-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                <ShieldAlert size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">بانتظار التحقق</p>
                <p className="text-2xl font-bold">{localSuppliers.filter(s => s.verificationRequested).length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">قائمة الموردين</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right hidden md:table-cell">المعرف</TableHead>
                    <TableHead className="text-right">اسم المورد</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">الفئة الرئيسية</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">الوثائق</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">طلب التوثيق</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">التوثيق</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.map((s) => (
                    <TableRow key={s.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-mono text-xs hidden md:table-cell">{s.id.substring(0, 8)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold">{s.name}</span>
                          <span className="text-xs text-muted-foreground">{s.contact}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{s.category}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex gap-1">
                          {s.hasCr && <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">CR</Badge>}
                          {s.hasCerts && <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-xs">شهادات</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {s.verificationRequested ? (
                          <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">طلب مقدم</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {s.verified ? (
                          <div className="flex items-center gap-1 text-success text-xs font-medium">
                            <CheckCircle2 size={14} />
                            موثق
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted-foreground text-xs font-medium">
                            <XCircle size={14} />
                            غير موثق
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(s.status)}</TableCell>
                      <TableCell className="text-left">
                        {s.verified ? (
                          <Button variant="outline" size="sm" onClick={() => handleVerify(s.id, false)} className="text-destructive border-destructive/20 hover:bg-destructive/5">
                            إلغاء التوثيق
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => handleVerify(s.id, true)} className="gap-1" disabled={!s.hasCr || !s.hasCerts}>
                            <CheckCircle2 size={14} />
                            توثيق
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                 </Table>
              )}
              {suppliers && suppliers.length >= limitCount && (
                <div className="p-4 text-center">
                  <Button variant="outline" onClick={() => setLimitCount(limitCount + 20)}>
                    عرض المزيد
                  </Button>
                </div>
              )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
