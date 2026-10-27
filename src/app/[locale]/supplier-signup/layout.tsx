import { FirebaseClientProvider } from '@/firebase/client-provider';

export default function SupplierSignupLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
