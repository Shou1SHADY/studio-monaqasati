import type { Metadata } from 'next';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ScopedIntl } from '@/components/ScopedIntl';
import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScopedIntl portal="all">
      <FirebaseClientProvider>
        {children}
        <RagChatWidget userRole="Admin" />
      </FirebaseClientProvider>
    </ScopedIntl>
  );
}
