"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"
import { useTranslations } from "next-intl"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"

export default function NotFoundPage() {
  const t = useTranslations("NotFound")

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 rtl:dir-rtl ltr:dir-ltr">
      <div className="absolute top-6 right-6">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md border-none shadow-lg">
        <CardContent className="p-8 text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-full bg-amber-50 flex items-center justify-center">
            <AlertTriangle size={32} className="text-amber-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-800">404</h1>
            <h2 className="text-xl font-semibold text-slate-700">{t("title")}</h2>
            <p className="text-muted-foreground">
              {t("desc")}
            </p>
          </div>
          <Button asChild className="w-full gap-2">
            <Link href="/">
              {t("back_to_home")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
