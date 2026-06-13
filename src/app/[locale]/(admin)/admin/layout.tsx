import { RagChatWidget } from '@/components/rag/RagChatWidget';

export const dynamic = "force-dynamic"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RagChatWidget userRole="Admin" />
    </>
  );
}
