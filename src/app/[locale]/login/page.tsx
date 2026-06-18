"use client"

import { useState } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import Image from "next/image"
import { useFirebase } from "@/firebase"
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, fetchSignInMethodsForEmail, linkWithCredential } from "firebase/auth"
import { doc, getDoc, setDoc, deleteDoc, updateDoc, query, where, collection, getDocs, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowRight, CheckCircle2, ShieldCheck, Mail } from "lucide-react"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { useTranslations, useLocale } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export default function LoginPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()
  const t = useTranslations("Auth.Login")
  const locale = useLocale()

  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  })

  // 2FA States
  const [showTwoFactor, setShowTwoFactor] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [tempUserData, setTempUserData] = useState<{ uid: string; role: string; name: string; phone: string } | null>(null)

  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState("")
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

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
      const methods = await fetchSignInMethodsForEmail(auth, resetEmail.trim().toLowerCase()).catch(() => [])
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

  const sendTwoFactorCode = async (uid: string, phone: string) => {
    if (!firestore) return false
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    try {
      await setDoc(doc(firestore, "users", uid, "2fa", "current"), {
        code,
        expiresAt
      })

      const messageBody = t("sms_body", { code })
      const smsRes = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone.startsWith("+") ? phone : `+966${phone.replace(/^0/, "")}`,
          body: messageBody
        })
      })

      if (!smsRes.ok) {
        console.error("Twilio SMS send failed, displaying OTP for fallback.")
        toast({
          title: t("test_env_code"),
          description: t("test_env_desc", { code }),
        })
        return true
      }

      toast({
        title: t("code_sent"),
        description: t("code_sent_desc")
      })
      return true
    } catch (error) {
      console.error("Error triggering 2FA:", error)
      return false
    }
  }

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firestore || !tempUserData) return

    setTwoFactorLoading(true)
    try {
      const otpDoc = await getDoc(doc(firestore, "users", tempUserData.uid, "2fa", "current"))
      if (!otpDoc.exists()) {
        throw new Error(t("err_code_not_found"))
      }

      const otpData = otpDoc.data()
      if (new Date() > new Date(otpData.expiresAt)) {
        throw new Error(t("err_code_expired"))
      }

      if (otpData.code !== twoFactorCode) {
        throw new Error(t("err_code_invalid"))
      }

      await deleteDoc(doc(firestore, "users", tempUserData.uid, "2fa", "current"))
      sessionStorage.setItem(`2fa_verified_${tempUserData.uid}`, "true")

      toast({
        title: t("success_login"),
        description: t("welcome_user", { name: tempUserData.name }),
      })

      if (tempUserData.role === "Admin") {
        router.push("/admin")
      } else if (tempUserData.role === "Contractor") {
        router.push("/contractor")
      } else if (tempUserData.role === "Supplier") {
        router.push("/supplier")
      } else {
        throw new Error(t("err_unknown_role"))
      }
    } catch (error: any) {
      toast({
        title: t("err_2fa_failed"),
        description: error.message || t("err_2fa_process"),
        variant: "destructive"
      })
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    if (!auth || !firestore) return
    setIsLoading(true)
    setLoginError("")
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const user = result.user

      const userDoc = await getDoc(doc(firestore, "users", user.uid))

      if (userDoc.exists()) {
        const userData = userDoc.data()
        const role = userData.role

        // Update lastLoginAt on every Google login
        await updateDoc(doc(firestore, "users", user.uid), { lastLoginAt: serverTimestamp() }).catch(() => {})

        if (userData.twoFactorEnabled && userData.phone) {
          setTempUserData({
            uid: user.uid,
            role: role,
            name: userData.name || t("dear_user"),
            phone: userData.phone
          })
          const sent = await sendTwoFactorCode(user.uid, userData.phone)
          if (sent) {
            setShowTwoFactor(true)
            setIsLoading(false)
            return
          }
        }

        toast({
          title: t("success_login"),
          description: t("welcome_user", { name: userData.name || t("dear_user") }),
        })

        if (role === "Admin") {
          router.push("/admin")
        } else if (role === "Contractor") {
          router.push("/contractor")
        } else if (role === "Supplier") {
          router.push("/supplier")
        } else {
          throw new Error(t("err_unknown_role"))
        }
      } else {
        // Google sign-in succeeded but no Firestore doc by this UID
        // Check if user exists with this email (different auth provider)
        const emailQuery = query(
          collection(firestore, "users"),
          where("email", "==", user.email?.toLowerCase())
        )
        const emailSnapshot = await getDocs(emailQuery)

        if (!emailSnapshot.empty) {
          // Account exists with email/password — don't create duplicate
          // Sign out Google user and prompt password sign-in for linking
          await auth.signOut()
          setFormData(prev => ({ ...prev, email: user.email?.toLowerCase() || prev.email }))
          setLoginError(t("err_existing_password_account"))
          setIsLoading(false)
          return
        }

        // Truly new user — create Firestore doc
        await setDoc(doc(firestore, "users", user.uid), {
          id: user.uid,
          email: user.email?.toLowerCase(),
          name: user.displayName || "",
          role: "Contractor",
          organizationId: "",
          organizationRole: "",
          phone: "",
          specializations: [],
          providers: ["google.com"] as string[],
          isVerified: false,
          profileCompleted: false,
          joinedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        })

        toast({
          title: t("success_register"),
          description: t("welcome_user", { name: user.displayName || t("dear_user") }),
        })

        router.push("/register?role=Contractor")
      }
    } catch (error: any) {
      // Silently stop loading when user dismisses the popup — no error shown
      if (
        error.code === "auth/cancelled-popup-request" ||
        error.code === "auth/popup-closed-by-user" ||
        error.code === "auth/user-cancelled" ||
        error.message?.includes("popup-closed-by-user") ||
        error.message?.includes("cancelled-popup-request")
      ) {
        return
      }
      // Handle: email already used with password provider
      if (error.code === "auth/account-exists-with-different-credential") {
        const email = error.customData?.email || ""
        const credential = GoogleAuthProvider.credentialFromError(error)
        setFormData(prev => ({ ...prev, email }))
        setPendingGoogleCred(credential)
        setShowGooglePrompt(true)
        setLoginError(t("err_link_google"))
        return
      }
      // Never surface raw Firebase error messages to users
      setLoginError(t("err_google_login"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !firestore) return

    setIsLoading(true)
    setLoginError("")
    try {
      // If we have a pending Google credential, first sign in with password,
      // then link the Google credential (account linking flow)
      if (pendingGoogleCred) {
        const userCredential = await signInWithEmailAndPassword(auth, formData.email.trim().toLowerCase(), formData.password)
        await linkWithCredential(userCredential.user, pendingGoogleCred)
        setPendingGoogleCred(null)
        setShowGooglePrompt(false)

        const userDoc = await getDoc(doc(firestore, "users", userCredential.user.uid))
        if (!userDoc.exists()) throw new Error(t("err_user_not_found"))

        const userData = userDoc.data()

        // Update Firestore to reflect linked providers and last login
        await updateDoc(doc(firestore, "users", userCredential.user.uid), {
          providers: ["password", "google.com"] as string[],
          lastLoginAt: serverTimestamp(),
        })

        toast({
          title: t("success_link"),
          description: t("welcome_user", { name: userData.name || t("dear_user") }),
        })

        const role = userData.role
        if (role === "Admin") router.push("/admin")
        else if (role === "Contractor") router.push("/contractor")
        else if (role === "Supplier") router.push("/supplier")
        else throw new Error(t("err_unknown_role"))
        return
      }

      const userCredential = await signInWithEmailAndPassword(auth, formData.email.trim().toLowerCase(), formData.password)
      const user = userCredential.user

      const userDoc = await getDoc(doc(firestore, "users", user.uid))

      if (!userDoc.exists()) {
        throw new Error(t("err_user_not_found"))
      }

      const userData = userDoc.data()
      let role = userData.role

      // Update lastLoginAt on every email login
      await updateDoc(doc(firestore, "users", user.uid), { lastLoginAt: serverTimestamp() }).catch(() => {})

      // Auto-promote admin@munaqasati.sa to Admin
      if (user.email === "admin@munaqasati.sa" && role !== "Admin") {
        try {
          await updateDoc(doc(firestore, "users", user.uid), { role: "Admin" })
          role = "Admin"
        } catch (e) {
          console.error("Failed to promote to Admin:", e)
        }
      }

      if (userData.twoFactorEnabled && userData.phone) {
          setTempUserData({
            uid: user.uid,
            role: role,
            name: userData.name || t("dear_user"),
            phone: userData.phone
          })
        const sent = await sendTwoFactorCode(user.uid, userData.phone)
        if (sent) {
          setShowTwoFactor(true)
          setIsLoading(false)
          return
        }
      }

      toast({
        title: t("success_login"),
        description: t("welcome_user", { name: userData.name || t("dear_user") }),
      })

      if (role === "Admin") {
        router.push("/admin")
      } else if (role === "Contractor") {
        router.push("/contractor")
      } else if (role === "Supplier") {
        router.push("/supplier")
      } else {
        throw new Error(t("err_unknown_role"))
      }

    } catch (error: any) {
      let errorMsg = t("err_login")

      // Check if this email uses Google Sign-In (no password set)
      if (error.code === "auth/user-not-found" || error.code === "auth/invalid-credential") {
        const methods = await fetchSignInMethodsForEmail(auth, formData.email.trim().toLowerCase()).catch(() => [])
        if (methods.includes("google.com") && !methods.includes("password")) {
          // This account uses Google — prompt user to sign in with Google
          setShowGooglePrompt(true)
          errorMsg = t("err_use_google")
        } else if (methods.length === 0) {
          errorMsg = t("err_no_account")
        } else {
          errorMsg = t("err_invalid_creds")
        }
      } else if (error.code === "auth/invalid-email") {
        errorMsg = t("err_invalid_email")
      } else if (error.code === "auth/user-disabled") {
        errorMsg = t("err_user_disabled")
      } else if (error.code === "auth/too-many-requests") {
        errorMsg = t("err_too_many_requests")
      } else if (error.code === "auth/network-request-failed") {
        errorMsg = t("err_network")
      } else {
        console.error("Login error:", error)
      }

      setLoginError(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen bg-background flex rtl:dir-rtl ltr:dir-ltr">
      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col px-6 md:px-16 lg:px-24 xl:px-32 relative overflow-y-auto py-6">
        {/* Navbar inside form area */}
        <div className="flex items-center justify-between w-full mb-8 shrink-0">
          <Link href="/" className="flex items-center gap-2 group text-muted-foreground hover:text-foreground transition-colors">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" />
            <span className="font-bold text-sm">{t("back_to_home")}</span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <div className="flex items-center">
              <Image 
                src="/logo2.png" 
                alt="Mdmak Tech" 
                width={120} 
                height={41} 
                className="h-8 w-auto object-contain" 
                priority 
              />
            </div>
          </div>
        </div>

        {/* Login Form */}
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
                    onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  />
                </div>

                <Button type="submit" className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all" disabled={twoFactorLoading}>
                  {twoFactorLoading ? <Loader2 className="animate-spin" /> : t("confirm_code")}
                </Button>
              </form>

              <div className="flex flex-col gap-2 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full h-11 text-sm font-semibold text-primary hover:bg-primary/5 transition-all"
                  onClick={() => tempUserData && sendTwoFactorCode(tempUserData.uid, tempUserData.phone)}
                >
                  {t("resend_code")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 text-sm font-bold border-border hover:bg-muted transition-all"
                  onClick={() => {
                    setShowTwoFactor(false)
                    setTwoFactorCode("")
                    setTempUserData(null)
                  }}
                >
                  {t("back_to_login")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-10 text-start rtl:text-right ltr:text-left">
                <h1 className="text-3xl font-extrabold text-foreground mb-3 font-headline">{t('submit_login')}</h1>
                <p className="text-muted-foreground text-sm">{t("welcome_back_title")}</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                  <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg border border-destructive/20 flex items-start gap-2">
                    <ShieldCheck className="w-5 h-5 shrink-0" />
                    <span>{loginError}</span>
                  </div>
                )}
                {showGooglePrompt && (
                  <div className="bg-sky-500/10 text-sky-600 text-sm font-medium p-3 rounded-lg border border-sky-500/20 flex items-center gap-2">
                    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>{pendingGoogleCred ? t("err_link_google") : t("err_use_google")}</span>
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
                    onChange={e => { setFormData({ ...formData, email: e.target.value }); setProviderCheckDone(false); setShowGooglePrompt(false); setPendingGoogleCred(null) }}
                    onBlur={handleEmailBlur}
                  />
                  {/* Provider indicator */}
                  {providerCheckDone && emailProviders.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                      {emailProviders.includes("google.com") && emailProviders.includes("password")
                        ? t("providers_both")
                        : emailProviders.includes("password")
                          ? t("providers_password")
                          : emailProviders.includes("google.com")
                            ? t("providers_google")
                            : ""}
                    </div>
                  )}
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
                    <Input
                      id="password"
                      type="password"
                      required
                      placeholder="••••••••"
                      className="text-left dir-ltr h-12 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta"
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                    />
                  </div>
                )}

                {showGooglePrompt && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-12 rounded-lg border border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground font-bold transition-all flex items-center justify-center gap-3"
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {t("login_google")}
                  </Button>
                )}

                {/* Submit button — visible whenever the password field is visible */}
                {!showGooglePrompt && (!providerCheckDone || !emailProviders.includes("google.com") || emailProviders.includes("password")) && (
                  <Button type="submit" className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : t('submit_login')}
                  </Button>
                )}
              </form>

              {!showGooglePrompt && (
              <>
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
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {t("login_google")}
              </Button>
              </>
              )}
            </>
          )}

          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("no_account")}{" "}
            <Link href="/register" className="text-primary font-semibold hover:text-primary/80 transition-colors">
              {t("create_account")}
            </Link>
          </p>
        </div>
      </div>

      {/* Left Side - Image */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/images/loading-dock.jpg"
          alt="Mdmak Tech Platform"
          className="w-full h-full object-cover ltr:-scale-x-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 z-10 text-white rtl:text-right ltr:text-left">
          <h2 className="text-3xl font-bold text-white mb-4 font-headline">
            {t("side_title")}
          </h2>
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">
            {t("side_desc")}
          </p>
        </div>
      </div>

      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
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
    </div>
  )
}
