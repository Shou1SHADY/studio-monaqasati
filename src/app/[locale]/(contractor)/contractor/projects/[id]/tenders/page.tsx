import { redirect } from "next/navigation"

export default async function ProjectTendersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // This standalone list view was a duplicate of the project page's own RFQs tab —
  // retired in favor of that tab, which has the same functionality (plus grid/list
  // toggle, column customizer, and bulk actions). Kept as a redirect so old links
  // and bookmarks still land somewhere useful instead of 404ing.
  redirect(`/contractor/projects/${id}?tab=rfqs`)
}
