import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ScopedIntl } from '@/components/ScopedIntl'
import { ROUTE_PORTAL_SCOPES } from '@/i18n/route-scopes'

export default function SupplierSignupLayout({ children }: { children: React.ReactNode }) {
  return <ScopedIntl portal={ROUTE_PORTAL_SCOPES.supplierSignup}><FirebaseClientProvider>{children}</FirebaseClientProvider></ScopedIntl>;
}
