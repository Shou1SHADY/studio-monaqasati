"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import Image from "next/image"
import { useFirebase } from "@/firebase"
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  User,
} from "firebase/auth"
import { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowRight, CheckCircle2, ShieldCheck, Mail, Eye, EyeOff } from "lucide-react"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { fetchLoginHint } from "@/lib/loginHint"
import { useTranslations, useLocale } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OnboardingWizard } from "@/components/OnboardingWizard"

const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
)

export default function LoginPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()
  const t = useTranslations("Auth.Login")
  const locale = useLocale()

  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [formData, setFormData] = useState({ email: "", password: "" })
  const [showDemo, setShowDemo] = useState(false)

  // 2FA states
  const [showTwoFactor, setShowTwoFactor] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [tempUserData, setTempUserData] = useState<{ uid: string; role: string; name: string; phone: string } | null>(null)

  // Forgot password states
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState("")
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Provider-aware auth
  const [emailProviders, setEmailProviders] = useState<string[]>([])
  const [providerCheckDone, setProviderCheckDone] = useState(false)
  const [pendingGoogleCred, setPendingGoogleCred] = useState<any>(null)
  const [showGooglePrompt, setShowGooglePrompt] = useState(false)

  const handleEmailBlur = async () => {
    if (!auth || !formData.email.trim()) return
    try {
      const methods = await fetchSignInMethodsForEmail(auth, formData.email.trim().toLowerCase())
      setEmailProviders(methods)
      setProviderCheckDone(true)
    } catch { /* ignore */ }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.trim() || !auth) return
    setResetLoading(true)
    try {
      // Block reset for Google-only accounts — they have no password to reset
      const methods: string[] = await fetchSignInMethodsForEmail(auth, resetEmail.trim().toLowerCase()).catch(() => [])
      if (methods.includes("google.com") && !methods.includes("password")) {
        toast({ title: t("forgot_password_error_title"), description: t("err_use_google"), variant: "destructive" })
        return
      }
      await sendPasswordResetEmail(auth, resetEmail.trim())
      setResetSent(true)
      toast({ title: t("forgot_password_title"), description: t("forgot_password_success_desc") })
    } catch (err: any) {
      const msg = err.code === 'auth/user-not-found'
        ? t("forgot_password_no_user")
        : t("forgot_password_error")
      toast({ title: t("forgot_password_error_title"), description: msg, variant: "destructive" })
    } finally {
      setResetLoading(false)
    }
  }

  const sendTwoFactorCode = useCallback(async (uid: string, phone: string) => {
    if (!firestore) return false
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    try {
      await setDoc(doc(firestore, "users", uid, "2fa", "current"), { code, expiresAt })
      const messageBody = t("sms_body", { code })
      const smsRes = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone.startsWith("+") ? phone : `+966${phone.replace(/^0/, "")}`,
          body: messageBody,
        }),
      })
      if (!smsRes.ok) {
        console.error("Twilio SMS send failed, displaying OTP for fallback.")
        toast({ title: t("test_env_code"), description: t("test_env_desc", { code }) })
        return true
      }
      toast({ title: t("code_sent"), description: t("code_sent_desc") })
      return true
    } catch (error) {
      console.error("Error triggering 2FA:", error)
      return false
    }
  }, [firestore, t, toast])

  // Shared post-auth handler — runs after any successful Firebase Auth sign-in.
  // Checks the Firestore profile, handles 2FA, and redirects to the dashboard.
  // isGoogle=true uses a Google-specific "no account" message instead of the generic one.
  const completeLogin = useCallback(async (user: User, isGoogle: boolean) => {
    if (!firestore || !auth) return

    let userDoc
    try {
      userDoc = await getDoc(doc(firestore, "users", user.uid))
    } catch {
      // Transient Firestore failure (network / App Check) — keep the session alive so
      // the user can retry; do NOT sign out blindly.
      setLoginError(t("err_try_again"))
      setIsLoading(false)
      return
    }

    if (!userDoc.exists()) {
      // Authenticated but no Firestore profile — sign out and surface an error.
      await auth.signOut()
      setLoginError(isGoogle ? t("err_google_no_acc") : t("err_invalid_creds"))
      setIsLoading(false)
      return
    }

    const userData = userDoc.data()
    let role = userData.role

    // Admin auto-promote for the known admin email (email login only)
    if (!isGoogle && user.email === "admin@munaqasati.sa" && role !== "Admin") {
      try {
        await updateDoc(doc(firestore, "users", user.uid), { role: "Admin" })
        role = "Admin"
      } catch { /* non-critical */ }
    }

    await updateDoc(doc(firestore, "users", user.uid), { lastLoginAt: serverTimestamp() }).catch(() => {})

    if (userData.twoFactorEnabled && userData.phone) {
      setTempUserData({ uid: user.uid, role, name: userData.name || t("dear_user"), phone: userData.phone })
      const sent = await sendTwoFactorCode(user.uid, userData.phone)
      if (sent) { setShowTwoFactor(true); setIsLoading(false); return }
    }

    toast({ title: t("success_login"), description: t("welcome_user", { name: userData.name || t("dear_user") }) })

    if (role === "Admin") router.push("/admin")
    else if (role === "Contractor") router.push("/contractor")
    else if (role === "Supplier") router.push("/supplier")
    else { setLoginError(t("err_unknown_role")); setIsLoading(false) }
  }, [firestore, auth, t, toast, router, sendTwoFactorCode])

  // Handle the result when signInWithRedirect completes (popup-blocked fallback).
  useEffect(() => {
    if (!auth || !firestore) return
    getRedirectResult(auth)
      .then(async (result) => {
        if (!result) return
        setIsLoading(true)
        await completeLogin(result.user, true)
      })
      .catch(() => { /* no pending redirect or redirect failed — no-op */ })
  }, [auth, firestore, completeLogin])

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firestore || !tempUserData) return
    setTwoFactorLoading(true)
    try {
      const otpDoc = await getDoc(doc(firestore, "users", tempUserData.uid, "2fa", "current"))
      if (!otpDoc.exists()) throw new Error(t("err_code_not_found"))
      const otpData = otpDoc.data()
      if (new Date() > new Date(otpData.expiresAt)) throw new Error(t("err_code_expired"))
      if (otpData.code !== twoFactorCode) throw new Error(t("err_code_invalid"))
      await deleteDoc(doc(firestore, "users", tempUserData.uid, "2fa", "current"))
      sessionStorage.setItem(`2fa_verified_${tempUserData.uid}`, "true")
      toast({ title: t("success_login"), description: t("welcome_user", { name: tempUserData.name }) })
      if (tempUserData.role === "Admin") router.push("/admin")
      else if (tempUserData.role === "Contractor") router.push("/contractor")
      else if (tempUserData.role === "Supplier") router.push("/supplier")
      else throw new Error(t("err_unknown_role"))
    } catch (error: any) {
      toast({ title: t("err_2fa_failed"), description: error.message || t("err_2fa_process"), variant: "destructive" })
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !firestore) return
    setIsLoading(true)
    setLoginError("")
    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        formData.email.trim().toLowerCase(),
        formData.password
      )
      await completeLogin(user, false)
    } catch (error: any) {
      // Rate-limit and network errors get specific messages; everything else starts as
      // generic to avoid revealing whether the email is registered (enumeration protection).
      if (error.code === "auth/too-many-requests") {
        setLoginError(t("err_too_many_requests"))
      } else if (error.code === "auth/network-request-failed") {
        setLoginError(t("err_network"))
      } else if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        // Keep the loading spinner while we fetch the hint (avoids the flash of
        // "Invalid email or password" → "Please continue with Google").
        // Cap at 1.5 s so a slow/unreachable hint API never stalls the form.
        const hint = await Promise.race([
          fetchLoginHint(formData.email.trim().toLowerCase()),
          new Promise<"generic">((resolve) => setTimeout(() => resolve("generic"), 1500)),
        ])
        setLoginError(hint === "google" ? t("err_use_google_hint") : t("err_invalid_creds"))
      } else {
        setLoginError(t("err_invalid_creds"))
      }
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    if (!auth) return
    setIsLoading(true)
    setLoginError("")
    const provider = new GoogleAuthProvider()
    try {
      const result = await signInWithPopup(auth, provider)
      await completeLogin(result.user, true)
    } catch (error: any) {
      if (
        error.code === "auth/popup-closed-by-user" ||
        error.code === "auth/cancelled-popup-request" ||
        error.code === "auth/user-cancelled"
      ) {
        // User dismissed the popup — silent no-op
        setIsLoading(false)
      } else if (error.code === "auth/popup-blocked") {
        // Fall back to redirect; page will reload and getRedirectResult handles the rest
        await signInWithRedirect(auth, provider)
      } else if (error.code === "auth/account-exists-with-different-credential") {
        setLoginError(t("err_link_google"))
        setIsLoading(false)
      } else {
        setLoginError(t("err_try_again"))
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="h-screen bg-background flex rtl:dir-rtl ltr:dir-ltr">
      {/* Form side */}
      <div className="flex-1 flex flex-col bg-background px-6 md:px-16 lg:px-24 xl:px-32 relative overflow-y-auto py-6 scrollbar-hide">
        <div className="flex items-center justify-between w-full mb-8 shrink-0">
          <Link href="/" className="flex items-center gap-2 group text-muted-foreground hover:text-foreground transition-colors">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" />
            <span className="font-bold text-sm">{t("back_to_home")}</span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Image src="/logo2.png" alt="Mdmak Tech" width={120} height={41} className="h-8 w-auto object-contain" priority />
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto">
          {showTwoFactor ? (
            <div className="text-start space-y-6">
              <div className="mb-8">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <ShieldCheck size={28} />
                </div>
                <h1 className="text-3xl font-extrabold text-foreground mb-3 font-headline">{t("two_factor")}</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t("two_factor_desc")}
                  <span className="font-bold text-foreground block dir-ltr text-start mt-1">{tempUserData?.phone}</span>
                </p>
              </div>

              <form onSubmit={handleVerifyTwoFactor} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-foreground font-bold">{t("otp_label")}</Label>
                  <Input
                    id="otp"
                    type="text"
                    required
                    maxLength={6}
                    placeholder="••••••"
                    className="text-center font-bold tracking-[1em] text-xl h-14 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta"
                    value={twoFactorCode}
                    onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all" disabled={twoFactorLoading}>
                  {twoFactorLoading ? <Loader2 className="animate-spin" /> : t("confirm_code")}
                </Button>
              </form>

              <div className="flex flex-col gap-2 pt-4">
                <Button type="button" variant="ghost" className="w-full h-11 text-sm font-semibold text-primary hover:bg-primary/5 transition-all"
                  onClick={() => tempUserData && sendTwoFactorCode(tempUserData.uid, tempUserData.phone)}>
                  {t("resend_code")}
                </Button>
                <Button type="button" variant="outline" className="w-full h-11 text-sm font-bold border-border hover:bg-muted transition-all"
                  onClick={() => { setShowTwoFactor(false); setTwoFactorCode(""); setTempUserData(null) }}>
                  {t("back_to_login")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-10 text-start rtl:text-right ltr:text-left">
                <h1 className="text-3xl font-extrabold text-foreground mb-3 font-headline">{t("submit_login")}</h1>
                <p className="text-muted-foreground text-sm">{t("welcome_back_title")}</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                  <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg border border-destructive/20 flex items-start gap-2">
                    <ShieldCheck className="w-5 h-5 shrink-0" />
                    <span>{loginError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-start block text-slate-700 font-bold">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="name@company.com"
                    className="text-left dir-ltr h-12 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                {/* Password — hidden when email only has Google provider */}
                {!showGooglePrompt && (!providerCheckDone || !emailProviders.includes("google.com") || emailProviders.includes("password")) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-foreground font-bold">{t("password")}</Label>
                      <button type="button" onClick={() => { setResetEmail(formData.email); setResetSent(false); setShowForgotPassword(true) }} className="text-sm font-semibold text-cta hover:text-cta/80 transition-colors">
                        {t("forgot_password")}
                      </button>
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="••••••••"
                        className="text-left dir-ltr h-12 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta pr-11"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : t("submit_login")}
                </Button>
              </form>

              <div className="relative my-6 text-center">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <span className="relative bg-background px-3 text-xs text-muted-foreground font-bold">{t("or_via")}</span>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-lg border border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground font-bold transition-all flex items-center justify-center gap-3"
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                <GoogleIcon />
                {t("login_google")}
              </Button>
            </>
          )}

          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("no_account")}{" "}
            <button
              type="button"
              onClick={() => setShowDemo(true)}
              className="text-primary font-semibold hover:text-primary/80 transition-colors"
            >
              {t("create_account")}
            </button>
          </p>
        </div>
      </div>

      {/* Image side */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/images/loading-dock.jpg"
          alt="Mdmak Tech Platform"
          className="w-full h-full object-cover ltr:-scale-x-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 z-10 text-white rtl:text-right ltr:text-left">
          <h2 className="text-3xl font-bold text-white mb-4 font-headline">{t("side_title")}</h2>
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">{t("side_desc")}</p>
        </div>
      </div>

      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={20} className="text-primary" />
              {t("forgot_password_title")}
            </DialogTitle>
            <DialogDescription>
              {resetSent ? t("forgot_password_sent_desc") : t("forgot_password_desc")}
            </DialogDescription>
          </DialogHeader>
          {resetSent ? (
            <div className="py-4 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-success" />
              </div>
              <p className="text-sm text-muted-foreground">{t("forgot_password_check_email")}</p>
              <Button variant="outline" onClick={() => setShowForgotPassword(false)} className="w-full">
                {t("forgot_password_close")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">{t("email")}</Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="dir-ltr text-left"
                />
              </div>
              <Button type="submit" disabled={resetLoading || !resetEmail.trim()} className="w-full gap-2">
                {resetLoading ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {t("forgot_password_send")}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <OnboardingWizard open={showDemo} onClose={() => setShowDemo(false)} />
    </div>
  )
}
