import { FirebaseClientProvider } from '@/firebase/client-provider';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
