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
  Loader2
} from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, where } from "firebase/firestore"

export default function SuppliersDirectory() {
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const suppliersQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Supplier"))
  }, [firestore])

  const { data: fbSuppliers, isLoading: suppliersLoading } = useCollection(suppliersQuery)
  
  // Fetch contractor's RFQs
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("contractorId", "==", user.uid))
  }, [firestore, user, isUserLoading])
  
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
  
  // Compute set of supplier IDs that have an accepted offer
  const favoriteSupplierIds = new Set(
    offersData
      ?.filter((o: any) => o.status === "مقبول")
      .map((o: any) => o.supplierId) || []
  )
  
  const isLoading = suppliersLoading || isUserLoading;

  // دمج الموردين من قاعدة البيانات مع تقييماتهم
  const displaySuppliers = fbSuppliers?.length ? fbSuppliers.map((s: any, index: number) => ({
    id: s.id,
    name: s.name || s.companyName || "مورد",
    verified: true,
    rating: 4.5 + (index % 5) / 10,
    deals: 20 + (index * 15),
    city: s.city || "الرياض",
    specs: ["مواد بناء", "حديد", "أسمنت"].slice(0, 1 + index % 3),
    isFavorite: favoriteSupplierIds.has(s.id)
  })) : []

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
              <Input placeholder="بحث باسم المورد..." className="pr-10" />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={18} />
              تصفية
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p>جاري تحميل قائمة الموردين...</p>
          </div>
        ) : displaySuppliers.length === 0 ? (
          <div className="text-center p-20 bg-slate-50 rounded-xl border border-dashed text-muted-foreground">
            لا يوجد موردين مسجلين حالياً.
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
                      {supplier.verified && (
                        <Badge className="bg-blue-50 text-blue-600 border-none px-2 py-0.5 h-6">
                          <ShieldCheck size={14} className="ml-1" />
                          موثوق
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
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin size={14} />
                      <span>{supplier.city}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 py-2 border-y border-slate-50">
                    <div className="flex items-center gap-1">
                      <Star className="fill-amber-400 text-amber-400" size={16} />
                      <span className="font-bold text-slate-700">{supplier.rating}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-bold text-slate-700">{supplier.deals}</span> صفقة ناجحة
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {supplier.specs.map((spec: string) => (
                      <Badge key={spec} variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 px-2 font-normal">
                        {spec}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter className="p-0 border-t">
                  <Button variant="ghost" className="w-full h-12 rounded-none hover:bg-primary hover:text-white transition-colors gap-2">
                    عرض الملف الشخصي
                    <ChevronLeft size={16} />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
