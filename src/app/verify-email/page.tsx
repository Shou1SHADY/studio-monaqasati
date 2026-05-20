"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useFirebase } from "@/firebase"
import { sendEmailVerification, signOut } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Loader2, Mail, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react"

export default function VerifyEmailPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState("")

  useEffect(() => {
    if (!auth) return
    
    // Subscribe to auth state
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setCurrentUserEmail(user.email || "")
        if (user.emailVerified) {
          // If already verified, route to dashboard
          handleRedirectToDashboard(user.uid)
        }
      } else {
        router.push("/login")
      }
    })

    return () => unsubscribe()
  }, [auth])

  const handleRedirectToDashboard = async (uid: string) => {
    if (!firestore) return
    try {
      const userDoc = await getDoc(doc(firestore, "users", uid))
      if (userDoc.exists()) {
        const role = userDoc.data().role
        if (role === "Admin") {
          router.push("/admin")
        } else if (role === "Contractor") {
          router.push("/contractor")
        } else if (role === "Supplier") {
          router.push("/supplier")
        } else {
          router.push("/")
        }
      } else {
        router.push("/register")
      }
    } catch (err) {
      console.error(err)
      router.push("/")
    }
  }

  const handleCheckStatus = async () => {
    if (!auth || !auth.currentUser) return
    setIsChecking(true)
    try {
      // Reload user profile to fetch fresh emailVerified flag
      await auth.currentUser.reload()
      const user = auth.currentUser

      if (user.emailVerified) {
        toast({
          title: "تم تفعيل البريد الإلكتروني",
          description: "مرحباً بك في منصة مدماك تيك! تم التحقق من حسابك بنجاح.",
        })
        await handleRedirectToDashboard(user.uid)
      } else {
        toast({
          title: "البريد غير مفعل بعد",
          description: "يرجى تفعيل البريد الإلكتروني عبر الرابط المرسل إلى صندوق الوارد الخاص بك.",
          variant: "destructive"
        })
      }
    } catch (error: any) {
      toast({
        title: "خطأ أثناء التحقق",
        description: error.message || "حدث خطأ غير متوقع",
        variant: "destructive"
      })
    } finally {
      setIsChecking(false)
    }
  }

  const handleResendEmail = async () => {
    if (!auth || !auth.currentUser) return
    setIsLoading(true)
    try {
      await sendEmailVerification(auth.currentUser)
      toast({
        title: "تم إرسال رابط التفعيل",
        description: "تم إرسال رابط تفعيل جديد إلى بريدك الإلكتروني بنجاح. يرجى مراجعة صندوق الوارد (أو مجلد البريد العشوائي).",
      })
    } catch (error: any) {
      console.error(error)
      toast({
        title: "فشل إرسال الرابط",
        description: error.message || "يرجى المحاولة مجدداً بعد قليل.",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    if (!auth) return
    try {
      await signOut(auth)
      router.push("/login")
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-100 shadow-2xl p-8 md:p-10 space-y-8 relative overflow-hidden group">
        {/* Decorative Top Accent */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-cta to-secondary" />

        {/* Header Branding */}
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-base">م</div>
            <span className="text-lg font-bold text-foreground font-headline tracking-tight">مدماك تيك</span>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-900 transition-colors"
          >
            تسجيل الخروج
            <ArrowRight size={14} className="rotate-180" />
          </button>
        </div>

        {/* Verification Content */}
        <div className="text-center space-y-6">
          <div className="relative inline-flex items-center justify-center">
            {/* Glowing background */}
            <div className="absolute inset-0 bg-primary/5 rounded-full scale-150 animate-pulse" />
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg relative z-10">
              <Mail size={36} className="text-white" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 font-headline leading-tight">يرجى تفعيل بريدك الإلكتروني</h1>
            <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
              لقد أرسلنا رابط تفعيل إلى بريدك الإلكتروني المسجل:
              <span className="font-bold text-slate-800 block mt-1 dir-ltr text-center">{currentUserEmail || "جاري التحميل..."}</span>
            </p>
          </div>
        </div>

        {/* Quick Alert */}
        <div className="bg-amber-50/60 border border-amber-100 p-4 rounded-2xl flex gap-3 text-right">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
          <p className="text-xs text-amber-800 leading-relaxed font-semibold">
            لم تجد الرسالة؟ يرجى مراجعة مجلد البريد العشوائي (Spam) أو انقر على زر إعادة الإرسال أدناه.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <Button 
            className="w-full h-12 text-sm font-bold rounded-xl shadow-lg bg-primary hover:bg-secondary text-white hover:scale-[1.02] active:scale-[0.98] transition-all"
            onClick={handleCheckStatus}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <Loader2 className="animate-spin ml-2" size={16} />
                جاري التحقق من التفعيل...
              </>
            ) : (
              <>
                <CheckCircle2 className="ml-2" size={16} />
                تحقق من التفعيل الآن
              </>
            )}
          </Button>

          <Button 
            variant="outline"
            className="w-full h-12 text-sm font-bold rounded-xl border-slate-200 hover:bg-slate-50 transition-all"
            onClick={handleResendEmail}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin ml-2" size={16} />
                جاري الإرسال...
              </>
            ) : (
              "إعادة إرسال رابط التفعيل"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
