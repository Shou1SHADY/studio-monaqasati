import { FirebaseClientProvider } from '@/firebase/client-provider';
import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      {children}
      <RagChatWidget userRole="Supplier" />
    </FirebaseClientProvider>
  );
}
