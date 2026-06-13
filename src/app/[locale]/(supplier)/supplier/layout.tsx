import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RagChatWidget userRole="Supplier" />
    </>
  );
}
