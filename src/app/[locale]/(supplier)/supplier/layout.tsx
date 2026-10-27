import type { Metadata } from 'next';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ScopedIntl } from '@/components/ScopedIntl';
import { RagChatWidget } from '@/components/rag/RagChatWidget';
import { SupplierPlanFrame } from '@/components/supplier-free/SupplierPlanFrame';

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScopedIntl portal="all">
      <FirebaseClientProvider>
        <SupplierPlanFrame>{children}</SupplierPlanFrame>
        <RagChatWidget userRole="Supplier" />
      </FirebaseClientProvider>
    </ScopedIntl>
  );
}
