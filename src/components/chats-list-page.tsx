"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Loader2, ChevronLeft, ChevronRight, Clock } from "lucide-react"
import { useFirestore, useUser, useMemoFirebase, useCollection, useDoc } from "@/firebase"
import { collection, query, where, doc } from "firebase/firestore"
import { useRouter } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"

interface ChatsListPageProps {
  role: "contractor" | "supplier"
}

export function ChatsListPage({ role }: ChatsListPageProps) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const router = useRouter()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const chatsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    const field = role === "contractor" ? "contractorOrgId" : "supplierOrgId"
    return query(
      collection(firestore, "chats"),
      where(field, "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, role, profile?.organizationId])

  const { data: rawChats, isLoading } = useCollection(chatsQuery)

  // Sort client-side by lastMessageAt (most recent first), fallback to createdAt
  const chats = rawChats
    ? [...rawChats].sort((a: any, b: any) => {
        const aTime = a.lastMessageAt || a.createdAt
        const bTime = b.lastMessageAt || b.createdAt
        return (bTime ? new Date(bTime).getTime() : 0) - (aTime ? new Date(aTime).getTime() : 0)
      })
    : []

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("chat_list_title")}</h1>
          <p className="text-muted-foreground mt-1">
            {role === "contractor"
              ? t("chat_list_desc_contractor")
              : t("chat_list_desc_supplier")}
          </p>
        </div>

        <div className="max-w-3xl space-y-3">
          {isLoading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="animate-spin" size={40} />
              <p>{t("chat_list_loading")}</p>
            </div>
          ) : !chats || chats.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-200 shadow-none">
              <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                <MessageSquare size={48} className="opacity-20" />
                <p className="font-bold text-lg">{t("chat_list_empty_title")}</p>
                <p className="text-sm">
                  {role === "contractor"
                    ? t("chat_list_empty_desc_contractor")
                    : t("chat_list_empty_desc_supplier")}
                </p>
              </CardContent>
            </Card>
          ) : (
            chats.map((chat: any) => {
              const hasUnread = Array.isArray(chat.unreadFor) && user && chat.unreadFor.includes(user.uid)
              return (
                <Card
                  key={chat.id}
                  onClick={() => router.push(`/${role}/chat/${chat.id}`)}
                  className={`border shadow-sm hover:shadow-md transition-all cursor-pointer group ${
                    hasUnread ? "border-primary/30 bg-primary/5" : "border-none"
                  }`}
                >
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className={`relative h-12 w-12 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      hasUnread
                        ? "bg-primary text-white"
                        : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
                    }`}>
                      <MessageSquare size={22} />
                      {hasUnread && (
                        <span className={cn("absolute -top-1 h-4 w-4 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center", locale === 'ar' ? '-right-1' : '-left-1')}>
                          !
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`font-bold truncate ${hasUnread ? "text-primary" : "text-foreground"}`}>
                          {chat.rfqTitle || t("chat_list_contract_chat")}
                        </p>
                        {hasUnread && (
                          <Badge className="bg-primary text-white border-none text-[10px] px-2 py-0 shrink-0">
                            {t("chat_list_new")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {chat.lastMessage ? (
                          <p className={`text-xs truncate max-w-[280px] ${hasUnread ? "text-primary/80 font-medium" : "text-muted-foreground"}`}>
                            {chat.lastMessage}
                          </p>
                        ) : (
                          <Badge className="bg-success/10 text-success border-success/20 text-xs">{t("chat_list_accepted")}</Badge>
                        )}
                        <span className={cn("text-xs text-muted-foreground flex items-center gap-1 shrink-0", locale === 'ar' ? 'mr-auto' : 'ml-auto')} suppressHydrationWarning>
                          <Clock size={10} />
                          {(chat.lastMessageAt || chat.createdAt)
                            ? new Date(chat.lastMessageAt || chat.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US')
                            : ""}
                        </span>
                      </div>
                    </div>
                    {locale === 'ar' ? (
                      <ChevronLeft size={18} className={`shrink-0 transition-colors ${hasUnread ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                    ) : (
                      <ChevronRight size={18} className={`shrink-0 transition-colors ${hasUnread ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
