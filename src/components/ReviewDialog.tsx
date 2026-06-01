"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Star, Loader2, Award } from "lucide-react"
import { useFirestore } from "@/firebase"
import { collection, addDoc, doc, updateDoc, getDocs, query, where } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'

interface ReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  offerId: string
  rfqId: string
  reviewerId: string
  reviewerName: string
  reviewerRole: "Contractor" | "Supplier"
  revieweeId: string
  revieweeName: string
  revieweeRole: "Contractor" | "Supplier"
  onSubmitSuccess: () => void
}

export function ReviewDialog({
  open,
  onOpenChange,
  offerId,
  rfqId,
  reviewerId,
  reviewerName,
  reviewerRole,
  revieweeId,
  revieweeName,
  revieweeRole,
  onSubmitSuccess
}: ReviewDialogProps) {
  const [rating, setRating] = useState<number>(0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [comment, setComment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const firestore = useFirestore()
  const { toast } = useToast()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const handleSubmit = async () => {
    if (rating === 0) {
      toast({
        title: t("review_rating_required"),
        description: t("review_rating_required_desc"),
        variant: "destructive"
      })
      return
    }

    if (!firestore) return
    setIsSubmitting(true)

    try {
      // 1. Add review doc
      await addDoc(collection(firestore, "reviews"), {
        offerId,
        rfqId,
        reviewerId,
        reviewerName: reviewerName || "مستخدم",
        reviewerRole,
        revieweeId,
        revieweeName: revieweeName || "مستخدم",
        revieweeRole,
        rating,
        comment: comment.trim(),
        createdAt: new Date().toISOString()
      })

      // 2. Update the offer status/flag
      const offerRef = doc(firestore, "offers", offerId)
      if (reviewerRole === "Contractor") {
        await updateDoc(offerRef, { contractorRated: true })
      } else {
        await updateDoc(offerRef, { supplierRated: true })
      }

      // 3. Recalculate reviewee average rating
      try {
        const reviewsQuery = query(
          collection(firestore, "reviews"),
          where("revieweeId", "==", revieweeId)
        )
        const reviewsSnap = await getDocs(reviewsQuery)
        const reviewsList = reviewsSnap.docs.map(doc => doc.data())
        
        // Include the newly added review in the calculation
        const totalReviews = reviewsList.length + 1
        const totalRatingSum = reviewsList.reduce((sum, r) => sum + (r.rating || 0), 0) + rating
        const newAverage = parseFloat((totalRatingSum / totalReviews).toFixed(1))

        // Update user profile with rating
        const userRef = doc(firestore, "users", revieweeId)
        await updateDoc(userRef, {
          rating: newAverage,
          reviewsCount: totalReviews
        })
      } catch (calcError) {
        console.error("Failed to update average rating:", calcError)
      }

      toast({
        title: t("review_submitted_title"),
        description: t("review_submitted_desc")
      })

      // Reset form
      setRating(0)
      setComment("")
      onSubmitSuccess()
      onOpenChange(false)
    } catch (error: any) {
      console.error("Submit review failed:", error)
      toast({
        title: t("review_error"),
        description: t("review_submit_failed", { message: error.message }),
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md text-right border-none shadow-2xl rounded-3xl" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader className="space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 mb-2">
            <Award size={24} />
          </div>
          <DialogTitle className="text-xl font-black text-slate-900 text-center font-headline">{t("review_title")}</DialogTitle>
          <DialogDescription className="text-center text-slate-500">
            {t("review_desc", { name: revieweeName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Star Rating Select */}
          <div className="flex flex-col items-center gap-2">
            <Label className="text-sm font-bold text-slate-700">{t("review_rating_label")}</Label>
            <div className="flex items-center gap-1.5 direction-ltr">
              {[1, 2, 3, 4, 5].map((star) => {
                const isSelected = star <= (hoverRating || rating)
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 transition-transform hover:scale-125 focus:outline-none"
                  >
                    <Star
                      size={32}
                      className={`transition-colors ${
                        isSelected
                          ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.3)]"
                          : "text-slate-200"
                      }`}
                    />
                  </button>
                )
              })}
            </div>
            {rating > 0 && (
              <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full mt-1">
                {rating === 5 ? t("review_excellent") : rating === 4 ? t("review_very_good") : rating === 3 ? t("review_good") : rating === 2 ? t("review_fair") : t("review_very_bad")}
              </span>
            )}
          </div>

          {/* Review Comment Textarea */}
          <div className="space-y-2">
            <Label htmlFor="comment" className="text-slate-700 font-bold">{t("review_comment_label")}</Label>
            <Textarea
              id="comment"
              placeholder={t("review_comment_placeholder")}
              className="min-h-[100px] rounded-2xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary text-sm p-4 leading-relaxed"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            className="w-full h-11 text-sm font-bold rounded-xl shadow-lg shadow-primary/20"
            disabled={isSubmitting || rating === 0}
            onClick={handleSubmit}
          >
            {isSubmitting ? <Loader2 className="animate-spin ml-2 h-4 w-4" /> : null}
            {t("review_submit")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="w-full h-11 text-sm font-bold rounded-xl text-slate-500"
            onClick={() => onOpenChange(false)}
          >
            {t("review_cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
