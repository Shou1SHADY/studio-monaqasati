import { redirect } from "next/navigation"

export default async function TenderPage({ params }: { params: Promise<{ id: string; tenderId: string }> }) {
  const { id, tenderId } = await params;
  // Redirect to the offers sub-page which serves as the primary detail view for contractors
  redirect(`/contractor/projects/${id}/tenders/${tenderId}/offers`)
}
