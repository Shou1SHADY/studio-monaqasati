import type { Metadata } from 'next';
import { FirebaseClientProvider } from '@/firebase/client-provider';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
