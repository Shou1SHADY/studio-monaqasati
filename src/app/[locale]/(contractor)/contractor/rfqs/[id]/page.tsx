import { redirect } from "next/navigation"

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Redirect to the offers sub-page which serves as the primary detail view for contractors
  redirect(`/contractor/rfqs/${id}/offers`)
}
