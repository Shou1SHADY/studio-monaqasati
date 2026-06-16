import { FirebaseClientProvider } from '@/firebase/client-provider';

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
