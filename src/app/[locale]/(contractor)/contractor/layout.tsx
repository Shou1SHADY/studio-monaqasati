import { FirebaseClientProvider } from '@/firebase/client-provider';
import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export default function ContractorLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      {children}
      <RagChatWidget userRole="Contractor" />
    </FirebaseClientProvider>
  );
}
