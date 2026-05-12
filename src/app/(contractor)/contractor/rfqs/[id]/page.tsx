import { redirect } from "next/navigation"

export default function RfqPage({ params }: { params: { id: string } }) {
  // Redirect to the offers sub-page which serves as the primary detail view for contractors
  redirect(`/contractor/rfqs/${params.id}/offers`)
}
