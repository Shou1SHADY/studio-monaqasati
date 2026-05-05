"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md border-none shadow-lg">
        <CardContent className="p-8 text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-full bg-amber-50 flex items-center justify-center">
            <AlertTriangle size={32} className="text-amber-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-800">404</h1>
            <h2 className="text-xl font-semibold text-slate-700">الصفحة غير موجودة</h2>
            <p className="text-muted-foreground">
              عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
            </p>
          </div>
          <Button asChild className="w-full gap-2">
            <Link href="/">
              العودة للرئيسية
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
