import { FirebaseClientProvider } from "@/firebase/client-provider"
import { ScopedIntl } from '@/components/ScopedIntl'
import { ROUTE_PORTAL_SCOPES } from '@/i18n/route-scopes'

export default function GuestOfferLayout({ children }: { children: React.ReactNode }) {
  return <ScopedIntl portal={ROUTE_PORTAL_SCOPES.offer}><FirebaseClientProvider>{children}</FirebaseClientProvider></ScopedIntl>
}
