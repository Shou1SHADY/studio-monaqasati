import type { Metadata } from 'next';
import { FirebaseClientProvider } from '@/firebase/client-provider';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
