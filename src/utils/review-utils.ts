/**
 * Pure utility functions for review and rating system.
 */

export interface ReviewData {
  offerId: string
  rfqId: string
  reviewerId: string
  reviewerName: string
  reviewerRole: "Contractor" | "Supplier"
  revieweeId: string
  revieweeName: string
  revieweeRole: "Contractor" | "Supplier"
  rating: number
  comment: string
  createdAt: string
}

/**
 * Checks if a transaction is eligible for a review.
 * The review option should become available only after a transaction (offer status) is successfully marked as completed ("تم التسليم") between both parties.
 */
export function isReviewable(offerStatus: string, reviewerRated?: boolean): boolean {
  return offerStatus === "تم التسليم" && !reviewerRated
}

/**
 * Calculates the average rating of a user based on all their reviews.
 */
export function calculateAverageRating(ratings: number[]): number {
  if (!ratings || ratings.length === 0) return 0
  const sum = ratings.reduce((acc, val) => acc + val, 0)
  return parseFloat((sum / ratings.length).toFixed(1))
}

/**
 * Formats review data structure for Firestore submission.
 */
export function buildReviewPayload(params: {
  offerId: string
  rfqId: string
  reviewerId: string
  reviewerName: string
  reviewerRole: "Contractor" | "Supplier"
  revieweeId: string
  revieweeName: string
  revieweeRole: "Contractor" | "Supplier"
  rating: number
  comment: string
}): ReviewData {
  return {
    offerId: params.offerId,
    rfqId: params.rfqId,
    reviewerId: params.reviewerId,
    reviewerName: params.reviewerName || "مستخدم",
    reviewerRole: params.reviewerRole,
    revieweeId: params.revieweeId,
    revieweeName: params.revieweeName || "مستخدم",
    revieweeRole: params.revieweeRole,
    rating: Math.max(1, Math.min(5, params.rating)),
    comment: (params.comment || "").trim(),
    createdAt: new Date().toISOString()
  }
}

/**
 * Checks if the user's business profile meets verification requirements.
 * Both CR number and Tax ID must be present and non-empty.
 */
export function isBusinessVerified(profile: { crNumber?: string; taxNumber?: string } | null | undefined): boolean {
  if (!profile) return false
  return !!(profile.crNumber?.trim() && profile.taxNumber?.trim())
}
