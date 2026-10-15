"use client"

import { useParams } from "next/navigation"
import ChatPageContent from "@/components/chat-page-content"
import { PlanSwitch } from "@/components/supplier-free/PlanSwitch"
import { FreeChatRedirect } from "@/components/supplier-free/FreeInbox"

// The full portal keeps its chat page. A free account reaches this address only from an older push or e-mail link:
// it is sent to the deal the conversation belongs to, opened on the conversation, inside the free frame.
export default function SupplierChatPage() {
  const params = useParams<{ chatId: string }>()
  return <PlanSwitch free={<FreeChatRedirect chatId={String(params?.chatId || "")} />} full={<ChatPageContent backPath="/supplier/chats" />} />
}
