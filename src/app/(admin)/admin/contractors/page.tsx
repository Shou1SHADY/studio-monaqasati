"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Building2,
  Search,
  ShieldCheck,
  ShieldAlert,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  FileText,
  ExternalLink,
  AlertCircle,
  Award
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, updateDoc, doc, limit } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"

const DOC_LABELS: Record<string, string> = {
  cr: "السجل التجاري (CR)",
  vat: "شهادة ضريبة القيمة المضافة (VAT)",
  zakat: "شهادة الزكاة",
  gosi: "شهادة التأمينات الاجتماعية (GOSI)",
  chamber: "عضوية الغرفة التجارية",
}

export default function AdminContractorsPage() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [limitCount, setLimitCount] = useState(20)
  const [selectedContractor, setSelectedContractor] = useState<any>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)

  const contractorsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users"),
      where("role", "==", "Contractor"),
      limit(limitCount)
    )
  }, [firestore, user, isUserLoading, limitCount])

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"))
  }, [firestore, user, isUserLoading])

  const { data: contractors, isLoading } = useCollection(contractorsQuery)
  const { data: allRfqs } = useCollection(rfqsQuery)
  const [localContractors, setLocalContractors] = useState<any[]>([])

  useEffect(() => {
    if (contractors) {
      setLocalContractors(contractors.map((c: any) => {
        const legalDocs = c.legalDocuments || {}
        const uploadedDocKeys = Object.keys(legalDocs).filter(
          k => legalDocs[k]?.url && legalDocs[k].url.length > 0
        )
        // Count how many RFQs belong to this contractor's organization
        const rfqCount = allRfqs?.filter((r: any) => r.organizationId === (c.organizationId || c.id)).length || 0

        return {
          id: c.id,
          name: c.name || "غير محدد",
          contact: c.phone || "غير محدد",
          email: c.email || "",
          city: c.city || "",
          crNumber: c.crNumber || "",
          taxNumber: c.taxNumber || "",
          verified: c.isVerified || false,
          verificationRequested: c.verificationRequested || false,
          status: c.isVerified ? "نشط" : c.verificationRequested ? "بانتظار التوثيق" : "قيد المراجعة",
          legalDocuments: legalDocs,
          uploadedDocKeys,
          hasUploadedDocs: uploadedDocKeys.length > 0,
          hasAllRequiredDocs: !!(legalDocs.cr?.url?.length > 0 && legalDocs.vat?.url?.length > 0),
          hasCr: !!c.crNumber,
          certificates: c.certificates || [],
          hasCerts: (c.certificates?.length || 0) > 0,
          rfqCount,
        }
      }))
    }
  }, [contractors, allRfqs])

  const handleVerify = async (id: string, verify: boolean) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "users", id), {
        isVerified: verify,
        verificationRequested: false
      })
      setLocalContractors(prev =>
        prev.map(c => c.id === id
          ? { ...c, verified: verify, verificationRequested: false, status: verify ? "نشط" : "قيد المراجعة" }
          : c
        )
      )
      if (selectedContractor?.id === id) {
        setSelectedContractor((prev: any) =>
          prev ? { ...prev, verified: verify, verificationRequested: false, status: verify ? "نشط" : "قيد المراجعة" } : prev
        )
      }
      toast({ title: verify ? "✅ تم التوثيق بنجاح" : "تم إلغاء التوثيق", description: "تم تحديث حالة المقاول" })
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "نشط": return <Badge className="bg-success/10 text-success border-success/20">نشط</Badge>
      case "بانتظار التوثيق": return <Badge className="bg-amber-50 text-amber-600 border-amber-100">بانتظار التوثيق</Badge>
      default: return <Badge variant="secondary">قيد المراجعة</Badge>
    }
  }

  const filtered = localContractors.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contact.includes(searchQuery)
  )

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">إدارة المقاولين</h1>
            <p className="text-muted-foreground mt-1">مراقبة حسابات المقاولين والتحقق من أهليتهم ومستنداتهم</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو البريد..."
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

        {/* Stats — real data */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm bg-blue-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <Building2 size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المقاولين</p>
                <p className="text-2xl font-bold">{localContractors.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-success/5">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ShieldCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">موثقون</p>
                <p className="text-2xl font-bold">{localContractors.filter(c => c.verified).length}</p>
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
                <p className="text-2xl font-bold">{localContractors.filter(c => c.verificationRequested).length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">سجل المقاولين</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center text-muted-foreground">
                <Building2 className="mx-auto h-12 w-12 opacity-20 mb-3" />
                <p className="font-medium">لا يوجد مقاولون مطابقون</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right hidden md:table-cell">المعرف</TableHead>
                    <TableHead className="text-right">اسم الشركة</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">رقم السجل</TableHead>
                    <TableHead className="text-right hidden md:table-cell">المناقصات</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">المستندات</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">التوثيق</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-mono text-xs hidden md:table-cell">{c.id.substring(0, 8)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold">{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                        {c.crNumber || "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary" className="font-bold">{c.rfqCount}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {c.uploadedDocKeys.length > 0 ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                              {c.uploadedDocKeys.length} ملف PDF
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">لا يوجد</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {c.verified ? (
                          <div className="flex items-center gap-1 text-success text-xs font-medium">
                            <CheckCircle2 size={14} /> موثق
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted-foreground text-xs font-medium">
                            <XCircle size={14} /> غير موثق
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(c.status)}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setSelectedContractor(c); setShowDetailDialog(true) }}
                            className="gap-1"
                          >
                            <Eye size={14} />
                            عرض
                          </Button>
                          {c.verified ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerify(c.id, false)}
                              className="text-destructive border-destructive/20 hover:bg-destructive/5"
                            >
                              إلغاء
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={!c.hasAllRequiredDocs}
                              onClick={() => handleVerify(c.id, true)}
                              className="gap-1"
                            >
                              <CheckCircle2 size={14} />
                              توثيق
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {contractors && contractors.length >= limitCount && (
              <div className="p-4 text-center border-t">
                <Button variant="outline" onClick={() => setLimitCount(limitCount + 20)}>
                  عرض المزيد
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Building2 size={22} className="text-primary" />
                تفاصيل المقاول
              </DialogTitle>
              <DialogDescription>
                مراجعة بيانات ووثائق المقاول قبل منح أو رفض التوثيق
              </DialogDescription>
            </DialogHeader>

            {selectedContractor && (
              <div className="space-y-5 py-2">
                {/* Basic Info */}
                <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-lg text-slate-800">{selectedContractor.name}</h4>
                    {getStatusBadge(selectedContractor.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground">البريد الإلكتروني:</span><span className="mr-2 font-medium text-xs">{selectedContractor.email || "—"}</span></div>
                    <div><span className="text-muted-foreground">رقم الجوال:</span><span className="mr-2 font-medium">{selectedContractor.contact || "—"}</span></div>
                    <div><span className="text-muted-foreground">المدينة:</span><span className="mr-2 font-medium">{selectedContractor.city || "—"}</span></div>
                    <div><span className="text-muted-foreground">رقم السجل التجاري:</span><span className="mr-2 font-medium">{selectedContractor.crNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">الرقم الضريبي:</span><span className="mr-2 font-medium">{selectedContractor.taxNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">عدد المناقصات:</span><span className="mr-2 font-bold text-primary">{selectedContractor.rfqCount}</span></div>
                  </div>
                </div>

                <Separator />

                {/* Legal Documents */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    المستندات الرسمية المرفوعة
                  </h4>
                  {Object.entries(DOC_LABELS).map(([key, label]) => {
                    const docData = selectedContractor.legalDocuments?.[key]
                    const hasUrl = docData?.url && docData.url.length > 0
                    return (
                      <div
                        key={key}
                        className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${hasUrl ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-50 border-slate-200"}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${hasUrl ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-800">{label}</p>
                            {hasUrl ? (
                              <p className="text-xs text-emerald-700 font-medium mt-0.5">
                                مرفوع ✓
                                {docData.expiryDate && <span className="text-slate-500 mr-2">• تنتهي: {docData.expiryDate}</span>}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400 mt-0.5">لم يُرفع بعد</p>
                            )}
                          </div>
                        </div>
                        {hasUrl ? (
                          <a href={docData.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs font-bold border-emerald-300 hover:bg-emerald-50">
                              <ExternalLink size={13} />
                              فتح الملف
                            </Button>
                          </a>
                        ) : (
                          <Badge variant="secondary" className="text-xs shrink-0">غير موجود</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Certificates */}
                {selectedContractor.certificates?.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <Award size={18} className="text-purple-500" />
                        الشهادات ({selectedContractor.certificates.length})
                      </h4>
                      {selectedContractor.certificates.map((cert: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl border bg-purple-50/40 border-purple-100 flex items-center justify-between">
                          <div>
                            <p className="font-bold text-sm">{cert.name}</p>
                            <p className="text-xs text-muted-foreground">{cert.issuer}{cert.expiryDate && ` • تنتهي: {cert.expiryDate}`}</p>
                          </div>
                          {cert.documentUrl && (
                            <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="gap-1 text-xs">
                                <ExternalLink size={12} />
                                عرض
                              </Button>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Warning if no docs at all */}
                {!selectedContractor.hasAllRequiredDocs && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="text-destructive shrink-0 mt-0.5" size={18} />
                    <p className="text-sm text-destructive font-bold">
                      لا يمكن توثيق الحساب حتى يكمل المقاول رفع المستندات الرسمية (السجل التجاري والشهادة الضريبية).
                    </p>
                  </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowDetailDialog(false)}>
                    إغلاق
                  </Button>
                  {selectedContractor.verified ? (
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive border-destructive/20 hover:bg-destructive/5"
                      onClick={() => { handleVerify(selectedContractor.id, false); setShowDetailDialog(false) }}
                    >
                      إلغاء التوثيق
                    </Button>
                  ) : (
                    <Button
                      className="flex-1 gap-2"
                      disabled={!selectedContractor.hasAllRequiredDocs}
                      onClick={() => { handleVerify(selectedContractor.id, true); setShowDetailDialog(false) }}
                    >
                      <CheckCircle2 size={16} />
                      توثيق الحساب
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PortalLayout>
  )
}
