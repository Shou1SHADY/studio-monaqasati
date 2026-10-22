import { Suspense } from "react"
import { ChatsScreen } from "@/components/procurement/chats/ChatsScreen"

// «محادثاتي»: one conversation per sent purchase order (Procurement 2.0 MSG-02). The sidebar's entry points here.
export default function ContractorChatsPage() {
  return (
    <Suspense fallback={null}>
      <ChatsScreen />
    </Suspense>
  )
}
