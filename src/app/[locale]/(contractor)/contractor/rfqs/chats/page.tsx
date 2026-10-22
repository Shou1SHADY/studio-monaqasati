import { Suspense } from "react"
import { ChatsScreen } from "@/components/procurement/chats/ChatsScreen"

export default function ProcurementChatsPage() {
  return (
    <Suspense fallback={null}>
      <ChatsScreen />
    </Suspense>
  )
}
