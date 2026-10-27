import { FirebaseClientProvider } from "@/firebase/client-provider"
import { ScopedIntl } from '@/components/ScopedIntl'
import { ROUTE_PORTAL_SCOPES } from '@/i18n/route-scopes'

// The order link needs no sign-in, but its registration card opens the phone sign-in, which needs the Firebase provider.
export default function OrderLinkLayout({ children }: { children: React.ReactNode }) {
  return <ScopedIntl portal={ROUTE_PORTAL_SCOPES.po}><FirebaseClientProvider>{children}</FirebaseClientProvider></ScopedIntl>
}
