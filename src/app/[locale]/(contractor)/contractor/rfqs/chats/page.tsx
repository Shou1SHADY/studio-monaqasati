import { redirect } from "@/i18n/routing"

// «محادثاتي» lives at `/contractor/chats` — the sidebar's address. Under `/contractor/rfqs/…` the same screen was read as
// the RFQs tab (its rail, crumbs and back button said «طلبات العروض», review 3 #3), so this address only forwards, its
// query (`?po=`) with it, for the links and bookmarks that still name it.
export default async function ProcurementChatsRedirect({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) query.append(k, one)
  const qs = query.toString()
  redirect({ href: qs ? `/contractor/chats?${qs}` : "/contractor/chats", locale })
}
