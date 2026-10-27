import { FirebaseClientProvider } from "@/firebase/client-provider"
import { ScopedIntl } from '@/components/ScopedIntl'
import { ROUTE_PORTAL_SCOPES } from '@/i18n/route-scopes'

// The receiver's link page knows who is signed in: the member a delivery was forwarded to
// confirms with his own sign-in instead of a texted code (PUR-06). A guest needs no account.
export default function ReceiveLayout({ children }: { children: React.ReactNode }) {
  return <ScopedIntl portal={ROUTE_PORTAL_SCOPES.receive}><FirebaseClientProvider>{children}</FirebaseClientProvider></ScopedIntl>
}
