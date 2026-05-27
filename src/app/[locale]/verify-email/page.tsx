"use client"

import { useState, useEffect } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import { useFirebase } from "@/firebase"
import { sendEmailVerification, signOut } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { Loader2, Mail, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react"

export default function VerifyEmailPage() {
  const t = useTranslations("Auth.Verify")
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState("")
  const [isLocal, setIsLocal] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLocal(
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.startsWith("192.168.")
      )
    }
  }, [])

  useEffect(() => {
    if (!auth) return
    
    // Subscribe to auth state
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setCurrentUserEmail(user.email || "")
        // Check if bypassed locally
        const isBypassed = localStorage.getItem("dev_bypass_email_verification") === "true"
        if (user.emailVerified || (isLocal && isBypassed)) {
          // If already verified or bypassed, route to dashboard
          handleRedirectToDashboard(user.uid)
        }
      } else {
        router.push("/login")
      }
    })

    return () => unsubscribe()
  }, [auth, isLocal])

  const handleBypass = () => {
    localStorage.setItem("dev_bypass_email_verification", "true")
    toast({
      title: t("dev_bypass_success"),
      description: t("dev_bypass_success_desc"),
    })
    if (auth && auth.currentUser) {
      handleRedirectToDashboard(auth.currentUser.uid)
    } else {
      router.push("/")
    }
  }

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
          title: t("verified_title"),
          description: t("verified_desc"),
        })
        await handleRedirectToDashboard(user.uid)
      } else {
        toast({
          title: t("not_verified_title"),
          description: t("not_verified_desc"),
          variant: "destructive"
        })
      }
    } catch (error: any) {
      toast({
        title: t("check_error"),
        description: error.message || t("error_unexpected"),
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
        title: t("resend_success_title"),
        description: t("resend_success_desc"),
      })
    } catch (error: any) {
      console.error(error)
      toast({
        title: t("resend_failed_title"),
        description: error.message || t("resend_failed_desc"),
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
    <div className="h-screen bg-slate-50 flex items-center justify-center p-6 rtl:dir-rtl ltr:dir-ltr">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-100 shadow-2xl p-8 md:p-10 space-y-8 relative overflow-hidden group">
        {/* Decorative Top Accent */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-cta to-secondary" />

        {/* Header Branding */}
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-base">M</div>
            <span className="text-lg font-bold text-foreground font-headline tracking-tight">Mdmak Tech</span>
          </div>
          <div className="flex gap-4 items-center">
            <LanguageSwitcher className="text-xs" />
            <button 
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-900 transition-colors"
            >
              {t("logout")}
              <ArrowRight size={14} className="rtl:rotate-180 ltr:rotate-0" />
            </button>
          </div>
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
            <h1 className="text-2xl font-black text-slate-900 font-headline leading-tight">{t("please_verify")}</h1>
            <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
              {t("sent_link")}
              <span className="font-bold text-slate-800 block mt-1 dir-ltr text-center">{currentUserEmail || t("loading")}</span>
            </p>
          </div>
        </div>

        {/* Quick Alert */}
        <div className="bg-amber-50/60 border border-amber-100 p-4 rounded-2xl flex gap-3 text-start">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
          <p className="text-xs text-amber-800 leading-relaxed font-semibold">
            {t("not_found")}
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
                {t("checking_status")}
              </>
            ) : (
              <>
                <CheckCircle2 className="ml-2" size={16} />
                {t("check_status_btn")}
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
                {t("resending")}
              </>
            ) : (
              t("resend_btn")
            )}
          </Button>

          {isLocal && (
            <div className="pt-4 border-t border-dashed border-slate-200 space-y-3">
              <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-2xl flex gap-3 text-start">
                <AlertCircle className="text-blue-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-xs text-blue-900 font-bold">{t("dev_mode")}</p>
                  <p className="text-[11px] text-blue-800 leading-relaxed mt-1">
                    {t("dev_mode_desc")}
                  </p>
                </div>
              </div>
              <Button 
                variant="ghost"
                type="button"
                className="w-full h-11 text-xs font-bold rounded-xl text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 transition-all"
                onClick={handleBypass}
              >
                {t("dev_bypass_btn")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
