"use client"

import { useRouter } from "@/i18n/routing"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useMemo, useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Briefcase,
  MapPin,
  Star,
  ShieldCheck,
  Loader2,
  ArrowRight,
  Award,
  FolderOpen,
  Mail,
  Phone,
  Globe,
  Heart,
  CheckCircle2,
  Building2
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, doc, query, where, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { displayCategory, displayCity } from "@/lib/constants"
import { cn } from "@/lib/utils"

export default function ContractorSupplierProfilePage() {
  const t = useTranslations("Portal.Contractor")
  const tSupplier = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const params = useParams()
  const supplierId = params.id as string
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [tab, setTab] = useState<"overview" | "reviews">("overview")

  const supplierDocRef = useMemoFirebase(() => {
    if (!firestore || !supplierId) return null
    return doc(firestore, "users", supplierId)
  }, [firestore, supplierId])
  const { data: supplier, isLoading: isSupplierLoading } = useDoc(supplierDocRef)

  const reviewsQuery = useMemoFirebase(() => {
    if (!firestore || !supplierId) return null
    return query(collection(firestore, "reviews"), where("revieweeId", "==", supplierId))
  }, [firestore, supplierId])
  const { data: reviews, isLoading: isReviewsLoading } = useCollection(reviewsQuery)

  // Live computed average
  const computedRating = useMemo(() => {
    if (!reviews || reviews.length === 0) return { avg: supplier?.rating || 0, count: reviews?.length || 0 }
    const sum = reviews.reduce((acc: number, r: any) => acc + (r.rating || 0), 0)
    return {
      avg: parseFloat((sum / reviews.length).toFixed(1)),
      count: reviews.length
    }
  }, [reviews, supplier?.rating])

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const isFavorite = profile?.favoriteSuppliers?.includes(supplierId) || false

  const toggleFavorite = async () => {
    if (!userDocRef || !profile) return
    try {
      await updateDoc(userDocRef, {
        favoriteSuppliers: isFavorite ? arrayRemove(supplierId) : arrayUnion(supplierId)
      })
      toast({
        title: isFavorite ? t("suppliers_fav_removed") : t("suppliers_fav_added"),
        description: isFavorite ? t("suppliers_fav_removed_desc") : t("suppliers_fav_added_desc")
      })
    } catch {
      toast({
        title: t("offers_toast_error"),
        description: t("suppliers_fav_error"),
        variant: "destructive"
      })
    }
  }

  if (isSupplierLoading) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
          <Loader2 className="animate-spin mb-4" size={32} />
          <p>{t("suppliers_loading")}</p>
        </div>
      </PortalLayout>
    )
  }

  if (!supplier) {
    return (
      <PortalLayout>
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1 text-muted-foreground">
            <ArrowRight size={16} />
            {t("offers_back_to_tenders")}
          </Button>
          <Card className="border-dashed border-2 border-slate-200 shadow-none">
            <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
              <Briefcase size={48} className="opacity-20" />
              <p className="font-bold text-lg">{t("suppliers_not_found")}</p>
              <p className="text-sm">{t("suppliers_not_found_desc")}</p>
            </CardContent>
          </Card>
        </div>
      </PortalLayout>
    )
  }

  const name = supplier.name || supplier.companyName || t("suppliers_registered_supplier")
  const rating = computedRating.avg
  const reviewsCount = computedRating.count
  const certs = supplier.certificates || []
  const projects = supplier.projects || []

  return (
    <PortalLayout>
      <div className={cn("space-y-6", locale === 'ar' ? 'text-right' : 'text-left')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-0 gap-1 text-muted-foreground w-fit">
            <ArrowRight size={16} />
            {t("offers_back_to_tenders")}
          </Button>
        </div>

        {/* Hero */}
        <Card className="border-none shadow-xl bg-white overflow-hidden rounded-3xl">
          <div className="bg-gradient-to-l from-primary/5 via-primary/3 to-transparent px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Briefcase size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-slate-700">{t("supplier_profile_title")}</h3>
          </div>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="relative shrink-0">
                <div className="h-28 w-28 rounded-3xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white shadow-lg">
                  <Briefcase size={48} />
                </div>
                {supplier.isVerified && (
                  <div className="absolute -bottom-2 -left-2 bg-success text-white p-2 rounded-xl shadow-lg border-4 border-white">
                    <ShieldCheck size={20} />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-black text-slate-900 font-headline tracking-tight">{name}</h1>
                  {supplier.isVerified && (
                    <Badge className="bg-success/10 text-success border-none gap-1 font-bold">
                      <ShieldCheck size={12} />
                      {tSupplier("profile_verified_badge")}
                    </Badge>
                  )}
                  {supplier.isPremium && (
                    <Badge className="bg-amber-100 text-amber-700 border-none gap-1 font-bold">
                      <Award size={12} />
                      {tSupplier("premium_membership")}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                    <MapPin size={14} className="text-primary" />
                    <span className="font-bold">{displayCity(supplier.city, locale)}</span>
                    <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-500">{t("suppliers_hq")}</span>
                  </div>
                  {supplier.phone && (
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Phone size={12} />
                      <span className="font-mono text-xs dir-ltr">{supplier.phone}</span>
                    </div>
                  )}
                  {supplier.email && (
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Mail size={12} />
                      <span className="text-xs">{supplier.email}</span>
                    </div>
                  )}
                  {supplier.website && (
                    <a
                      href={supplier.website.startsWith('http') ? supplier.website : `https://${supplier.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <Globe size={12} />
                      <span className="text-xs">{t("offers_visit_website")}</span>
                    </a>
                  )}
                </div>

                {/* Rating Hero */}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 rounded-2xl border border-amber-100">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={18}
                          className={star <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-slate-200 fill-slate-200"}
                        />
                      ))}
                    </div>
                    <span className="font-black text-2xl text-amber-700 leading-none">{rating > 0 ? rating.toFixed(1) : "—"}</span>
                    <span className="text-xs text-amber-700/80 font-medium">
                      {t("suppliers_rating_count", { count: reviewsCount })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-2xl border border-blue-100">
                    <ShieldCheck size={16} className="text-blue-600" />
                    <span className="text-xs font-bold text-blue-700">{t("supplier_profile_certs_count", { count: certs.length })}</span>
                  </div>
                  <Button
                    variant={isFavorite ? "default" : "outline"}
                    size="sm"
                    onClick={toggleFavorite}
                    className={cn("gap-2 rounded-full", isFavorite && "bg-amber-500 hover:bg-amber-600 text-white border-none")}
                  >
                    <Heart size={14} className={isFavorite ? "fill-white" : ""} />
                    {isFavorite ? t("suppliers_remove_fav") : t("suppliers_add_fav")}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "reviews")} className="space-y-6">
          <TabsList className="bg-slate-100/50 border border-slate-200 w-fit">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
              <Building2 size={14} />
              {t("supplier_profile_tab_overview")}
            </TabsTrigger>
            <TabsTrigger value="reviews" className="data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
              <Star size={14} />
              {t("supplier_profile_tab_reviews", { count: reviewsCount })}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="m-0 space-y-6">
            {/* Coverage */}
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <MapPin size={16} className="text-primary" />
                  {t("suppliers_coverage")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-primary text-white flex items-center gap-1.5 px-3 py-1">
                    <MapPin size={12} />
                    {t("suppliers_hq")}: {displayCity(supplier.city, locale)}
                  </Badge>
                  {(supplier.coverageCities || []).map((city: string) => (
                    <Badge key={city} variant="outline" className="border-primary/30 text-primary bg-primary/5 flex items-center gap-1.5 px-3 py-1">
                      <MapPin size={12} />
                      {displayCity(city, locale)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Specializations */}
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Award size={16} className="text-primary" />
                  {t("suppliers_specs")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {supplier.specializations?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {supplier.specializations.map((spec: string) => (
                      <Badge key={spec} className="bg-primary/10 text-primary border-none text-sm">
                        {displayCategory(spec, locale)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t("suppliers_no_specs_registered")}</p>
                )}
              </CardContent>
            </Card>

            {/* About */}
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <CardTitle className="text-base font-bold">{t("suppliers_about")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed">
                  {supplier.description || t("suppliers_no_description")}
                </p>
              </CardContent>
            </Card>

            {/* Projects */}
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <FolderOpen size={16} className="text-primary" />
                  {t("suppliers_projects")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {projects.length > 0 ? (
                  <div className="grid gap-3">
                    {projects.map((project: any) => (
                      <div key={project.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <p className="font-bold text-sm text-slate-800">{project.name}</p>
                        {project.description && (
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{project.description}</p>
                        )}
                        {project.images?.length > 0 && (
                          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                            {project.images.map((img: string, idx: number) => (
                              <img
                                key={idx}
                                src={img}
                                alt={`${project.name} ${idx + 1}`}
                                className="h-24 w-32 object-cover rounded-lg border border-slate-200 shrink-0 hover:scale-105 transition-transform cursor-pointer"
                                onClick={() => window.open(img, '_blank')}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    {t("suppliers_no_projects")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Certificates */}
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ShieldCheck size={16} className="text-success" />
                  {t("suppliers_certificates")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {certs.length > 0 ? (
                  <div className="grid gap-3">
                    {certs.map((cert: any) => (
                      <div key={cert.id} className="p-3 bg-white border border-slate-200 rounded-lg flex items-start justify-between shadow-sm">
                        <div>
                          <p className="font-bold text-sm text-slate-800 flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-success" />
                            {cert.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{t("suppliers_cert_issuer")}: {cert.issuer}</p>
                          {(cert.issueDate || cert.expiryDate) && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              {t("suppliers_cert_valid_until")}: {cert.expiryDate || t("suppliers_unknown")}
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
                            {t("suppliers_view_doc")}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    {t("suppliers_no_certificates")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reviews" className="m-0">
            <Card className="border-none shadow-sm">
              <CardHeader className="border-b bg-slate-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Star size={18} className="text-amber-400 fill-amber-400" />
                  {t("suppliers_reviews_title", { count: reviewsCount })}
                </CardTitle>
                <CardDescription>{t("supplier_profile_reviews_anonymous_notice")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {isReviewsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin text-primary" size={28} />
                  </div>
                ) : reviews && reviews.length > 0 ? (
                  <div className="grid gap-3">
                    {reviews.map((review: any) => (
                      <div key={review.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center">
                              <Star size={14} className="text-slate-500" />
                            </div>
                            <p className="font-bold text-sm text-slate-700">{t("suppliers_anonymous_reviewer")}</p>
                          </div>
                          <div className="flex items-center gap-1.5 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100">
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  size={11}
                                  className={star <= Math.round(review.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-200 fill-slate-200"}
                                />
                              ))}
                            </div>
                            <span className="text-xs font-bold text-amber-700">{(review.rating || 0).toFixed(1)}</span>
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                            "{review.comment}"
                          </p>
                        )}
                        <p className={cn("text-[10px] text-slate-400", locale === 'ar' ? 'text-left' : 'text-right')}>
                          {new Date(review.createdAt).toLocaleDateString(locale)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-8 border border-dashed rounded-xl text-center bg-slate-50">
                    {t("suppliers_no_reviews_registered")}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  )
}
