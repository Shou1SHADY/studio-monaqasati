// Where a draft is published from (PUR-03): the editor's review step, never a button on a list.

export const rfqReviewHref = (id: string): string => `/contractor/rfqs/new?edit=${encodeURIComponent(id)}&step=review`
