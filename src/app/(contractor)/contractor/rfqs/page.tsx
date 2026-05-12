"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { FileText, PlusCircle, Eye, Calendar, Search, Package, ArrowRight, Loader2, Send, MapPin, X, File, Download, MessageCircle, User } from "lucide-react"
import Link from "next/link"
import { useCollectionPaginated, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, updateDoc } from "firebase/firestore"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES } from "@/lib/constants"

export default function ContractorRfqsPage() {
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [statusFilter, setStatusFilter] = useState<"all" | "Draft" | "New" | "Awarded">("all")
  const [selectedRfqs, setSelectedRfqs] = useState<string[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [deadlineFilter, setDeadlineFilter] = useState<"all" | "week" | "month" | "custom">("all")
  const [customDeadline, setCustomDeadline] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const hasActiveFilters = searchQuery || statusFilter !== "all" || deadlineFilter !== "all" || categoryFilter !== "all" || locationFilter !== "all"
  const clearFilters = () => {
    setSearchQuery("")
    setStatusFilter("all")
    setDeadlineFilter("all")
    setCategoryFilter("all")
    setLocationFilter("all")
    setCustomDeadline("")
    setSelectedRfqs([])
  }

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

const handleBatchPublish = async () => {
    if (!firestore || selectedRfqs.length === 0) return;
    setIsPublishing(true);
    try {
      for (const rfqId of selectedRfqs) {
        await updateDoc(doc(firestore, "rfqs", rfqId), {
          status: "New",
          visibility: "public",
          publishedAt: new Date().toISOString()
        });
      }
      toast({
        title: "تم النشر!",
        description: `تم نشر ${selectedRfqs.length} مناقصة بنجاح.`,
      });
      setSelectedRfqs([]);
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل نشر بعض المناقصات.",
        variant: "destructive"
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const toggleSelectRfq = (id: string) => {
    setSelectedRfqs(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const draftRfqs = filteredRfqs.filter((rfq: any) => rfq.status === "Draft").map((rfq: any) => rfq.id);
    setSelectedRfqs(draftRfqs);
  };

  // الإصلاح: منع إرسال الاستعلام حتى يكتمل تحميل حالة المستخدم من Firebase Auth
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    
    let q = query(
      collection(firestore, "rfqs"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    );

    if (statusFilter !== "all") {
      q = query(q, where("status", "==", statusFilter));
    }
    if (categoryFilter !== "all") {
      q = query(q, where("category", "==", categoryFilter));
    }
    if (locationFilter !== "all") {
      q = query(q, where("city", "==", locationFilter));
    }
    
    return q;
  }, [firestore, user, isUserLoading, statusFilter, categoryFilter, locationFilter, profile?.organizationId])

  const { data: rfqs, isLoading: isCollectionLoading, hasMore, loadMore, error } = useCollectionPaginated(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs && !error)
  const isLoadingMore = isCollectionLoading && !!rfqs

const filteredRfqs = rfqs?.filter((rfq: any) => {
    // Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = (
        rfq.title?.toLowerCase().includes(q) ||
        rfq.category?.toLowerCase().includes(q) ||
        rfq.subCategory?.toLowerCase().includes(q) ||
        rfq.id?.toLowerCase().includes(q)
      );
      if (!matchesSearch) return false;
    }

    // Deadline filter
    if (deadlineFilter !== "all" && rfq.deadline) {
      const deadline = new Date(rfq.deadline);
      const now = new Date();
      if (deadlineFilter === "week") {
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (deadline > weekFromNow) return false;
      } else if (deadlineFilter === "month") {
        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (deadline > monthFromNow) return false;
      } else if (deadlineFilter === "custom" && customDeadline) {
        const customDate = new Date(customDeadline);
        if (deadline > customDate) return false;
      }
    }

    return true;
  }).sort((a: any, b: any) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  }) || [];

  const getStatusBadge = (rfq: any) => {
    if (rfq.status === "Draft") {
      return <Badge className="bg-slate-100 text-slate-600 border-slate-300 font-bold">مسودة 📝</Badge>;
    }
    
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

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { value: "all", label: "الكل" },
            { value: "Draft", label: "مسودة" },
            { value: "New", label: "نشطة" },
            { value: "Awarded", label: "مكتملة" }
          ].map(tab => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "outline"}
              size="sm"
              className="rounded-lg cursor-pointer"
              onClick={() => {
                setStatusFilter(tab.value as any);
                setSelectedRfqs([]);
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-white border-b pb-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="text-primary" size={20} />
                  قائمة المناقصات
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  {selectedRfqs.length > 0 && (
                    <Button
                      onClick={handleBatchPublish}
                      disabled={isPublishing}
                      className="gap-2 bg-success hover:bg-success/90 rounded-lg"
                      size="sm"
                    >
                      {isPublishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                      نشر المحدد ({selectedRfqs.length})
                    </Button>
                  )}
                  {selectedRfqs.length === 0 && (
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input
                        placeholder="بحث في المناقصات..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pr-10 w-full sm:w-64 h-10 rounded-xl bg-slate-50 border-slate-200 focus:bg-white cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>
              {/* Filters Row */}
              <div className="flex flex-wrap gap-2">
                {/* Category Filter */}
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[140px] h-10 text-sm rounded-xl">
                    <SelectValue placeholder="التصنيف" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل التصنيفات</SelectItem>
                    {PREDEFINED_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Location Filter */}
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="w-[140px] h-10 text-sm rounded-xl">
                    <SelectValue placeholder="المدينة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المدن</SelectItem>
                    {SAUDI_CITIES.map(city => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Deadline Filter */}
                <Select value={deadlineFilter} onValueChange={(v: any) => setDeadlineFilter(v)}>
                  <SelectTrigger className="w-[140px] h-10 text-sm rounded-xl">
                    <SelectValue placeholder="الموعد النهائي" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المواعيد</SelectItem>
                    <SelectItem value="week">خلال أسبوع</SelectItem>
                    <SelectItem value="month">خلال شهر</SelectItem>
                    <SelectItem value="custom">تاريخ محدد</SelectItem>
                  </SelectContent>
                </Select>
                {deadlineFilter === "custom" && (
                  <input 
                    type="date" 
                    value={customDeadline}
                    onChange={e => setCustomDeadline(e.target.value)}
                    className="h-10 px-3 rounded-xl border border-input bg-white text-sm w-[140px]"
                  />
                )}
                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearFilters}
                    className="h-10 text-xs text-muted-foreground hover:text-destructive gap-1"
                  >
                    <X size={12} />
                    مسح الفلاتر
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {isLoading && (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>جاري تحميل البيانات...</p>
              </div>
            )}
            {error && (
              <div className="p-10 text-center space-y-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-600 font-bold">حدث خطأ أثناء جلب البيانات:</p>
                <p className="text-red-500 text-sm break-all" dir="ltr">{error.message}</p>
              </div>
            )}
            {!isLoading && !error && filteredRfqs.length === 0 && (
              <div className="p-20 text-center space-y-4">
                <p className="text-muted-foreground">
                  {searchQuery || categoryFilter !== "all" || locationFilter !== "all" || deadlineFilter !== "all" 
                    ? "لا توجد مناقصات مطابقة للفلترة المحددة." 
                    : "لا توجد مناقصات حالية."}
                </p>
                {!searchQuery && categoryFilter === "all" && locationFilter === "all" && deadlineFilter === "all" && (
                  <Link href="/contractor/rfqs/new">
                    <Button variant="outline">اطرح أول مناقصة الآن</Button>
                  </Link>
                )}
              </div>
            )}
            {!isLoading && filteredRfqs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredRfqs.map((rfq: any) => (
                  <Card key={rfq.id} className="group relative overflow-hidden border-slate-200/60 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 bg-white/60 backdrop-blur-xl flex flex-col">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex flex-wrap gap-2">
                          {rfq.status === "Draft" && (
                            <Checkbox
                              checked={selectedRfqs.includes(rfq.id)}
                              onCheckedChange={() => toggleSelectRfq(rfq.id)}
                              className="cursor-pointer ml-2"
                            />
                          )}
                          <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2.5 py-1">
                            {rfq.category}
                          </Badge>
                          {rfq.subCategory && (
                            <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/50 px-2.5 py-1">
                              {rfq.subCategory}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded-md">{rfq.id.substring(0, 8)}</span>
                      </div>
                      
                      <div className="space-y-1 mb-5 flex-1">
                        <h3 className="text-lg font-bold text-slate-800 group-hover:text-primary transition-colors line-clamp-2">
                          {rfq.title}
                        </h3>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-slate-50 w-fit px-2 py-1 rounded-md mt-2">
                          <Package size={14} className="text-primary" />
                          {rfq.products && rfq.products.length > 0 
                            ? `${rfq.products.length} منتج`
                            : `الكمية: ${rfq.quantity} ${rfq.unitOfMeasure}`
                          }
                        </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-slate-100/80 mb-5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                              <User size={12} className="text-slate-500" />
                            </div>
                            <span className="truncate">بواسطة: <span className="font-bold text-slate-700">{rfq.createdByUserName || "الإدارة"}</span></span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                            <MapPin size={12} className="text-blue-600" />
                          </div>
                          <span className="truncate">{rfq.city} - {rfq.district}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600" suppressHydrationWarning>
                          <div className="w-6 h-6 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                            <Calendar size={12} className="text-amber-600" />
                          </div>
                          الموعد: <span className="font-bold text-slate-700">{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString('ar-SA') : 'غير محدد'}</span>
                          {getStatusBadge(rfq)}
                        </div>
                        {rfq.pdfUrl && (
                          <a 
                            href={rfq.pdfUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            download
                            className="flex items-center gap-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors w-fit"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <File size={12} />
                            تحميل PDF
                          </a>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Link href={`/contractor/rfqs/${rfq.id}/offers`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-slate-200 hover:bg-primary hover:text-white hover:border-primary transition-all">
                            <Eye size={14} />
                            عرض العروض
                          </Button>
                        </Link>
                        <Link href={`/contractor/rfqs/${rfq.id}/offers?tab=inquiries`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full gap-1 text-sm h-9 rounded-lg border-slate-200 hover:bg-primary hover:text-white hover:border-primary transition-all">
                            <MessageCircle size={14} />
                            الاستفسارات
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {hasMore && filteredRfqs.length > 0 && (
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
        </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}