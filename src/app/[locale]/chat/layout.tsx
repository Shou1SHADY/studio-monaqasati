import { FirebaseClientProvider } from '@/firebase/client-provider';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>;
}
