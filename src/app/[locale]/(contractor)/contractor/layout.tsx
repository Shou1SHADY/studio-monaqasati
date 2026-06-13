import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export default function ContractorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RagChatWidget userRole="Contractor" />
    </>
  );
}
