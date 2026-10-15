import { PlanSwitch } from "@/components/supplier-free/PlanSwitch"
import { FreeMessages } from "@/components/supplier-free/FreeInbox"
import { ChatsListPage } from "@/components/chats-list-page"

function LegacySupplierChatsPage() {
  return <ChatsListPage role="supplier" />
}

export default function Page() {
  return <PlanSwitch free={<FreeMessages />} full={<LegacySupplierChatsPage />} />
}
