import { FirebaseClientProvider } from '@/firebase/client-provider';

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
