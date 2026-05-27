"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  MapPin, 
  Star, 
  ShieldCheck, 
  Filter, 
  ChevronLeft,
  Briefcase,
  Loader2,
  X,
  Heart
} from "lucide-react"
import { 
  Popover,
  PopoverContent,
  PopoverTrigger 
} from "@/components/ui/popover"
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from "@/components/ui/select"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
 
export default function SuppliersDirectory() {
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCity, setFilterCity] = useState<string>("all")
  const [filterSpecialization, setFilterSpecialization] = useState<string>("all")
  const [showFilters, setShowFilters] = useState(false)
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const suppliersQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Supplier"))
  }, [firestore])

  const { data: fbSuppliers, isLoading: suppliersLoading } = useCollection(suppliersQuery)
  
  // Fetch contractor's RFQs
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])
  
  const { data: myRfqs } = useCollection(rfqsQuery)
  const myRfqIds = myRfqs?.map((r: any) => r.id) || []
  
  // Fetch accepted offers for these RFQs
  const acceptedOffersQuery = useMemoFirebase(() => {
    if (!firestore || myRfqIds.length === 0) return null
    // We fetch all offers for these RFQs and filter locally to avoid complex composite indexes
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", myRfqIds.slice(0, 30)) // Firestore 'in' is limited to 30 elements
    )
  }, [firestore, myRfqIds.join(",")])
  
  const { data: offersData } = useCollection(acceptedOffersQuery)
  
  // Fetch supplier reviews when a supplier is selected (for detail modal)
  const supplierReviewsQuery = useMemoFirebase(() => {
    if (!firestore || !selectedSupplier) return null
    return query(
      collection(firestore, "reviews"),
      where("revieweeId", "==", selectedSupplier.id)
    )
  }, [firestore, selectedSupplier])
  const { data: supplierReviews } = useCollection(supplierReviewsQuery)

  // Fetch ALL supplier reviews to compute live averages for the cards
  const allSupplierReviewsQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(
      collection(firestore, "reviews"),
      where("revieweeRole", "==", "Supplier")
    )
  }, [firestore])
  const { data: allSupplierReviews } = useCollection(allSupplierReviewsQuery)

  // Build a map of supplierId -> { avgRating, count } from live reviews
  const supplierRatingsMap = (allSupplierReviews || []).reduce((acc: Record<string, { sum: number; count: number }>, r: any) => {
    if (!r.revieweeId) return acc
    if (!acc[r.revieweeId]) acc[r.revieweeId] = { sum: 0, count: 0 }
    acc[r.revieweeId].sum += r.rating || 0
    acc[r.revieweeId].count += 1
    return acc
  }, {})

  // Compute set of supplier IDs that have an accepted offer
  const implicitFavoriteIds = offersData
    ?.filter((o: any) => o.status === "مقبول")
    .map((o: any) => o.supplierId) || []
  const explicitFavoriteIds = profile?.favoriteSuppliers || []
  const favoriteSupplierIds = new Set([...implicitFavoriteIds, ...explicitFavoriteIds])

  const toggleFavorite = async (e: React.MouseEvent, supplierId: string) => {
    e.stopPropagation();
    if (!userDocRef || !profile) return;
    const isExplicit = explicitFavoriteIds.includes(supplierId);
    try {
      await updateDoc(userDocRef, {
        favoriteSuppliers: isExplicit ? arrayRemove(supplierId) : arrayUnion(supplierId)
      });
      toast({
        title: isExplicit ? "تم الإزالة" : "تمت الإضافة",
        description: isExplicit ? "تم إزالة المورد من المفضلة." : "تم إضافة المورد إلى المفضلة بنجاح.",
      });
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      toast({
        title: "خطأ",
        description: "تعذر تحديث المفضلة.",
        variant: "destructive"
      });
    }
  }
  
  const isLoading = suppliersLoading || isUserLoading;

  const allCities = [...new Set([
    ...(fbSuppliers?.map((s: any) => s.city).filter(Boolean) || []),
    ...(fbSuppliers?.flatMap((s: any) => s.coverageCities || []).filter(Boolean) || [])
  ])].sort()

  const allSpecializations = [...new Set(
    fbSuppliers?.flatMap((s: any) => s.specializations || []).filter(Boolean) || []
  )].sort()

  const displaySuppliers = fbSuppliers?.length ? fbSuppliers
    .map((s: any) => ({
      ...s,
      id: s.id,
      name: s.name || s.companyName || "مورد",
      city: s.city || s.location || "غير محدد",
      coverageCities: s.coverageCities || [],
      specializations: s.specializations || [],
      certificates: s.certificates || [],
      rating: supplierRatingsMap[s.id]
        ? parseFloat((supplierRatingsMap[s.id].sum / supplierRatingsMap[s.id].count).toFixed(1))
        : (s.rating || 0),
      reviewsCount: supplierRatingsMap[s.id]?.count ?? (s.reviewsCount || 0),
      isFavorite: favoriteSupplierIds.has(s.id),
      isExplicitFavorite: explicitFavoriteIds.includes(s.id)
    }))
    .filter((s: any) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = s.name?.toLowerCase().includes(q);
        const cityMatch = s.city?.toLowerCase().includes(q);
        const specMatch = s.specializations?.some((spec: string) => spec.toLowerCase().includes(q));
        if (!nameMatch && !cityMatch && !specMatch) return false;
      }
      // City filter
      if (filterCity !== "all") {
        const cityMatch = s.city === filterCity || s.coverageCities?.includes(filterCity);
        if (!cityMatch) return false;
      }
      // Specialization filter
      if (filterSpecialization !== "all") {
        const specMatch = s.specializations?.includes(filterSpecialization);
        if (!specMatch) return false;
      }
      return true;
    }) : []

  const hasActiveFilters = filterCity !== "all" || filterSpecialization !== "all"
  const clearFilters = () => {
    setFilterCity("all")
    setFilterSpecialization("all")
  }

  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-secondary font-headline">دليل الموردين</h1>
            <p className="text-muted-foreground mt-1">تصفح وتواصل مع أفضل الموردين المعتمدين في جميع المجالات</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="بحث باسم المورد..." 
                className="pr-10 pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-destructive transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Popover open={showFilters} onOpenChange={setShowFilters}>
              <PopoverTrigger asChild>
                <Button variant={hasActiveFilters ? "default" : "outline"} className="gap-2 relative">
                  <Filter size={18} />
                  تصفية
                  {hasActiveFilters && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-white text-[10px] rounded-full flex items-center justify-center">
                      {(filterCity !== "all" ? 1 : 0) + (filterSpecialization !== "all" ? 1 : 0)}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-right" dir="rtl">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm">خيارات التصفية</h4>
                    {hasActiveFilters && (
                      <button 
                        onClick={() => { clearFilters(); setShowFilters(false) }}
                        className="text-xs text-destructive hover:underline font-medium"
                      >
                        مسح الكل
                      </button>
                    )}
                  </div>
                  
                  {/* City Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">المدينة</label>
                    <Select value={filterCity} onValueChange={setFilterCity}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue placeholder="كل المدن" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل المدن</SelectItem>
                        {allCities.map((city: string) => (
                          <SelectItem key={city} value={city}>{city}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Specialization Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">التخصص</label>
                    <Select value={filterSpecialization} onValueChange={setFilterSpecialization}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue placeholder="كل التخصصات" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل التخصصات</SelectItem>
                        {allSpecializations.map((spec: string) => (
                          <SelectItem key={spec} value={spec}>{spec}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => setShowFilters(false)}
                  >
                    تطبيق
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p>جاري تحميل قائمة الموردين...</p>
          </div>
        ) : displaySuppliers.length === 0 ? (
          <div className="text-center p-20 bg-slate-50 rounded-xl border border-dashed text-muted-foreground">
            {searchQuery ? (
              <>
                <Search size={48} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-lg">لا توجد نتائج للبحث</p>
                <p className="text-sm mt-1">حاول تغيير كلمة البحث أو مسح الفلتر</p>
              </>
            ) : (
              "لا يوجد موردين مسجلين حالياً."
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displaySuppliers.map((supplier: any) => (
              <Card key={supplier.id} className={`hover:shadow-md transition-shadow overflow-hidden group flex flex-col ${supplier.isFavorite ? 'border-amber-200 bg-amber-50/10' : 'border-slate-100'}`}>
                <CardContent className="p-6 flex-1 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      <Briefcase size={28} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button 
                        onClick={(e) => toggleFavorite(e, supplier.id)}
                        className={`h-8 w-8 rounded-full flex items-center justify-center transition-all shadow-sm ${supplier.isExplicitFavorite ? 'bg-amber-100 text-amber-500' : 'bg-white text-slate-300 hover:text-amber-400 hover:bg-amber-50'} border border-slate-100`}
                        title={supplier.isExplicitFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                      >
                        <Heart size={16} className={supplier.isExplicitFavorite ? "fill-amber-500" : ""} />
                      </button>

                      {supplier.certificates?.length > 0 && (
                        <Badge className="bg-blue-50 text-blue-600 border-none px-2 py-0.5 h-6">
                          <ShieldCheck size={14} className="ml-1" />
                          {supplier.certificates.length} شهادة
                        </Badge>
                      )}
                      {supplier.isFavorite && (
                        <Badge variant="outline" className="border-amber-200 text-amber-600 bg-amber-50 px-2 py-0.5 h-6">
                          <Star size={10} className="ml-1 fill-amber-500" />
                          مورد مفضل
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg text-slate-800">{supplier.name}</h3>
                    <div className="flex items-center gap-1 mt-1">
                      {supplier.rating > 0 ? (
                        <>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              size={13}
                              className={star <= Math.round(supplier.rating) ? "fill-amber-400 text-amber-400" : "text-slate-200 fill-slate-200"}
                            />
                          ))}
                          <span className="text-sm font-bold text-slate-700 mr-1">{supplier.rating}</span>
                          <span className="text-[10px] text-muted-foreground">({supplier.reviewsCount || 0} تقييم)</span>
                        </>
                      ) : (
                        <>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} size={13} className="text-slate-200 fill-slate-200" />
                          ))}
                          <span className="text-[10px] text-muted-foreground mr-1">لا توجد تقييمات</span>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 mt-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin size={14} className="text-primary" />
                        <span className="font-medium">{supplier.city}</span>
                        <span className="text-[10px] bg-slate-100 px-1.5 rounded-sm">المقر</span>
                      </div>
                      {supplier.coverageCities?.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <MapPin size={12} className="text-accent" />
                          <div className="flex flex-wrap gap-1">
                            {supplier.coverageCities.slice(0, 2).map((city: string) => (
                              <span key={city} className="bg-accent/10 text-accent px-1.5 py-0.5 rounded text-[10px]">{city}</span>
                            ))}
                            {supplier.coverageCities.length > 2 && (
                              <span className="text-accent">+{supplier.coverageCities.length - 2}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Certificates badges */}
                  {supplier.certificates?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {supplier.certificates.slice(0, 3).map((cert: any) => (
                        <Badge key={cert.id} className="bg-green-50 text-green-700 border-green-100 text-[10px] px-2 font-normal gap-1">
                          <ShieldCheck size={10} />
                          {cert.name}
                        </Badge>
                      ))}
                      {supplier.certificates.length > 3 && (
                        <Badge variant="outline" className="text-[10px] px-2 text-slate-500">
                          +{supplier.certificates.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Specializations */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {supplier.specializations?.length > 0 ? (
                      supplier.specializations.slice(0, 3).map((spec: string) => (
                        <Badge key={spec} variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 px-2 font-normal">
                          {spec}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">لا توجد تخصصات</span>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="p-0 border-t">
                  <Button 
                    variant="ghost" 
                    className="w-full h-12 rounded-none hover:bg-primary hover:text-white transition-colors gap-2"
                    onClick={() => setSelectedSupplier(supplier)}
                  >
                    عرض الملف الشخصي
                    <ChevronLeft size={16} />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selectedSupplier} onOpenChange={(open) => !open && setSelectedSupplier(null)}>
        <DialogContent className="sm:max-w-[600px] text-right max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Briefcase className="text-primary" />
              ملف المورد: {selectedSupplier?.name}
            </DialogTitle>
            <DialogDescription>
              التفاصيل، الشهادات، ومعلومات العمل الخاصة بالمورد
            </DialogDescription>
          </DialogHeader>
          
          {selectedSupplier && (
            <div className="space-y-6 py-4">
              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">مناطق التغطية</h4>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-accent text-white flex items-center gap-1.5 px-3 py-1">
                    <MapPin size={14} />
                    المقر: {selectedSupplier.city}
                  </Badge>
                  {selectedSupplier.coverageCities?.map((city: string) => (
                    <Badge key={city} variant="outline" className="border-accent/30 text-accent bg-accent/5 flex items-center gap-1.5 px-3 py-1">
                      <MapPin size={14} />
                      {city}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">التخصصات</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedSupplier.specializations?.length ? selectedSupplier.specializations.map((spec: string) => (
                    <Badge key={spec} className="bg-primary/10 text-primary border-none">{spec}</Badge>
                  )) : (
                    <span className="text-sm text-slate-500">لا توجد تخصصات مسجلة</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">نبذة عن المورد</h4>
                <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {selectedSupplier.description || "لم يقم المورد بإضافة نبذة تعريفية بعد."}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-success" />
                  الشهادات والاعتمادات
                </h4>
                {selectedSupplier.certificates?.length > 0 ? (
                  <div className="grid gap-3">
                    {selectedSupplier.certificates.map((cert: any) => (
                      <div key={cert.id} className="p-3 bg-white border border-slate-200 rounded-lg flex items-start justify-between shadow-sm">
                        <div>
                          <p className="font-bold text-sm text-slate-800">{cert.name}</p>
                          <p className="text-xs text-slate-500 mt-1">جهة الإصدار: {cert.issuer}</p>
                          {(cert.issueDate || cert.expiryDate) && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              صالح لغاية: {cert.expiryDate || "غير محدد"}
                            </p>
                          )}
                        </div>
                        {cert.documentUrl && (
                          <a 
                            href={cert.documentUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-full font-medium transition-colors"
                          >
                            عرض المستند
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    لا توجد شهادات مسجلة لهذا المورد.
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <Star size={18} className="text-amber-400 fill-amber-400" />
                  تقييمات المورد ({supplierReviews?.length || 0})
                </h4>
                {supplierReviews && supplierReviews.length > 0 ? (
                  <div className="grid gap-3">
                    {supplierReviews.map((review: any) => (
                      <div key={review.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-sm text-slate-800">{review.reviewerName}</p>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-amber-600">{review.rating}</span>
                            <Star size={12} className="fill-amber-400 text-amber-400" />
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-xs text-slate-600 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                            "{review.comment}"
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400 text-left">
                          {new Date(review.createdAt).toLocaleDateString("ar-SA")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    لا توجد تقييمات مسجلة لهذا المورد حتى الآن.
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}
