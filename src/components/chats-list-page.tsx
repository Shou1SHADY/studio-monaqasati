"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Loader2, ChevronLeft, Clock } from "lucide-react"
import { useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { useRouter } from "next/navigation"

interface ChatsListPageProps {
  role: "contractor" | "supplier"
}

export function ChatsListPage({ role }: ChatsListPageProps) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const router = useRouter()

  const chatsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    const field = role === "contractor" ? "contractorId" : "supplierId"
    return query(
      collection(firestore, "chats"),
      where(field, "==", user.uid)
    )
  }, [firestore, user, isUserLoading, role])

  const { data: rawChats, isLoading } = useCollection(chatsQuery)

  // Sort client-side by createdAt descending (avoids composite index requirement)
  const chats = rawChats
    ? [...rawChats].sort((a: any, b: any) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
    : []

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">محادثاتي</h1>
          <p className="text-muted-foreground mt-1">
            {role === "contractor"
              ? "تواصل مع الموردين الذين قبلت عروضهم"
              : "تواصل مع المقاولين الذين قبلوا عروضك"}
          </p>
        </div>

        <div className="max-w-3xl space-y-3">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>جاري تحميل المحادثات...</p>
            </div>
          ) : !chats || chats.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <MessageSquare size={48} className="opacity-20" />
                <p className="font-bold text-lg">لا توجد محادثات حالياً</p>
                <p className="text-sm">
                  {role === "contractor"
                    ? "ستظهر المحادثات هنا بعد قبول عرض من أحد الموردين."
                    : "ستظهر المحادثات هنا بعد قبول المقاول لأحد عروضك."}
                </p>
              </CardContent>
            </Card>
          ) : (
            chats.map((chat: any) => (
              <Card
                key={chat.id}
                onClick={() => router.push(`/chat/${chat.id}`)}
                className="border-none shadow-sm hover:shadow-md transition-all cursor-pointer group"
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                    <MessageSquare size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground truncate">
                      {chat.rfqTitle || "محادثة عقد"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className="bg-success/10 text-success border-success/20 text-xs">مقبول ✅</Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
                        <Clock size={10} />
                        {chat.createdAt ? new Date(chat.createdAt).toLocaleDateString("ar-SA") : ""}
                      </span>
                    </div>
                  </div>
                  <ChevronLeft size={18} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
