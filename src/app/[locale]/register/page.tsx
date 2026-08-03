"use client"

import { useState, useEffect } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { useFirebase } from "@/firebase"
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification, type User } from "firebase/auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowRight, X, Eye, EyeOff, Mail } from "lucide-react"

// Public self-registration has been removed — the only way to get an
// account is an admin creating one from the admin portal (after reviewing a
// demo request), or accepting an invitation from an already-approved org
// owner. This page now only handles the latter: without a valid ?invite=
// token it redirects straight to the demo-request section.
export default function RegisterPage() {
  const t = useTranslations("Auth.Register")
  const router = useRouter()
  const { auth } = useFirebase()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [checkingInvite, setCheckingInvite] = useState(true)
  const [registerError, setRegisterError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({ name: "", email: "", password: "", phone: "" })

  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteInfo, setInviteInfo] = useState<
    | { type: "supplier_invite"; email: string; companyName: string | null; contractorName: string }
    | { type: "team_invite"; email: string; name: string | null; orgName: string; role: string }
    | null
  >(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const inviteParam = params.get("invite")
    if (!inviteParam) {
      router.replace("/#demo")
      return
    }
    setInviteToken(inviteParam)
  }, [router])

  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    const lookupInvite = async () => {
      try {
        const res = await fetch(`/api/invitations/lookup?token=${encodeURIComponent(inviteToken)}`)
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !data?.success) {
          router.replace("/#demo")
          return
        }
        setInviteInfo(data.data)
        if (data.data.type === "team_invite") {
          setFormData(prev => ({ ...prev, email: data.data.email || prev.email, name: prev.name || data.data.name || "" }))
        } else {
          setFormData(prev => ({ ...prev, email: data.data.email || prev.email, name: prev.name || data.data.companyName || "" }))
        }
        setCheckingInvite(false)
      } catch (err) {
        console.error("Failed to look up invitation:", err)
        if (!cancelled) router.replace("/#demo")
      }
    }
    lookupInvite()
    return () => { cancelled = true }
  }, [inviteToken, router])

  // Links the new account to the inviting org server-side, and creates the
  // Firestore profile if this is the user's first action after Auth signup
  // (client-side self-registration is blocked by firestore.rules — the
  // invitation itself is the authorization for this server call instead).
  const acceptInvite = async (user: User): Promise<{ ok: boolean; code?: string; message?: string }> => {
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token: inviteToken, name: formData.name, phone: formData.phone }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        return { ok: false, code: data?.code, message: data?.message }
      }
      return { ok: true }
    } catch (err) {
      console.error("Failed to accept invitation:", err)
      return { ok: false }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !inviteToken) return

    setIsLoading(true)
    setRegisterError("")
    try {
      if (formData.password.length < 6) {
        throw { code: "auth/weak-password", message: t("error_weak_pwd") }
      }

      const emailLower = formData.email.toLowerCase().trim()
      const userCredential = await createUserWithEmailAndPassword(auth, emailLower, formData.password)
      const user = userCredential.user

      await updateProfile(user, { displayName: formData.name })

      try {
        await sendEmailVerification(user)
      } catch (err) {
        console.error("Failed to send verification email:", err)
      }

      const acceptResult = await acceptInvite(user)
      if (!acceptResult.ok) {
        // No profile was created server-side — don't leave an orphaned Auth
        // account that can neither log in nor be re-invited to this email.
        await user.delete().catch(() => {})
        throw new Error(acceptResult.message || t("error_unexpected"))
      }

      if (inviteInfo?.type === "team_invite") {
        toast({ title: t("success_title"), description: t("invite_joined_team_desc", { org: inviteInfo.orgName || "" }) })
      } else if (inviteInfo?.type === "supplier_invite") {
        toast({ title: t("success_title"), description: t("invite_joined_supplier_desc", { contractor: inviteInfo.contractorName || "" }) })
      } else {
        toast({ title: t("success_title"), description: t("success_desc") })
      }

      router.push("/verify-email")
    } catch (error: any) {
      let errorMsg = error.message || t("error_unexpected")
      if (error.code === "auth/email-already-in-use") errorMsg = t("error_email_in_use")
      else if (error.code === "auth/weak-password") errorMsg = t("error_weak_pwd")
      else if (error.code === "auth/invalid-email") errorMsg = t("error_invalid_email")
      else if (!error.code) { /* server-side accept error — message already set above */ }
      else console.error("Registration error:", error)

      setRegisterError(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  if (checkingInvite) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="h-screen bg-white flex rtl:dir-rtl ltr:dir-ltr">
      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col bg-background px-6 md:px-16 lg:px-24 xl:px-32 relative overflow-y-auto py-6 scrollbar-hide">
        {/* Navbar inside form area */}
        <div className="flex items-center justify-between w-full mb-8 shrink-0">
          <Link href="/" className="flex items-center gap-2 group text-slate-500 hover:text-slate-900 transition-colors">
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

        {/* Register Form */}
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto py-8">
          <div className="mb-8 text-start">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-3 font-headline">{t("new_account")}</h1>
            <p className="text-slate-500 text-sm">{t("join_now")}</p>
          </div>

          {inviteInfo && (
            <div className="mb-6 bg-accent/10 border border-accent/30 rounded-xl p-4 flex items-start gap-3">
              <Mail className="w-5 h-5 text-cta shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-slate-900">
                  {inviteInfo.type === "team_invite" ? t("team_invite_banner_title") : t("invite_banner_title")}
                </p>
                <p className="text-sm text-slate-600 mt-0.5">
                  {inviteInfo.type === "team_invite"
                    ? t("team_invite_banner_desc", { name: inviteInfo.orgName || t("invite_banner_fallback_name") })
                    : t("invite_banner_desc", { name: inviteInfo.contractorName || t("invite_banner_fallback_name") })}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {registerError && (
              <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg border border-destructive/20 flex items-start gap-2">
                <X className="w-5 h-5 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name" className="text-slate-700 font-bold">{t("company_name")}</Label>
              <Input
                id="name"
                required
                placeholder={t("company_name_ph")}
                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-slate-700 font-bold">{t("phone")}</Label>
              <Input
                id="phone"
                required
                type="tel"
                placeholder={t("phone_ph")}
                className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.phone}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '')
                  setFormData({ ...formData, phone: val })
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-bold">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="name@company.com"
                className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 font-bold">{t("password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary pr-11"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 text-white transition-all"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="animate-spin" /> : t("confirm_register")}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t("have_account")}{" "}
            <Link href="/login" className="text-cta font-bold hover:underline">
              {t("login_now")}
            </Link>
          </p>
        </div>
      </div>

      {/* Left Side - Image/Artwork */}
      <div className="hidden lg:flex flex-1 relative bg-slate-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent z-10" />
        <img
          src="/images/loading-dock.jpg"
          alt="Mdmak Tech Platform Architecture"
          className="absolute inset-0 w-full h-full object-cover opacity-80 ltr:-scale-x-100"
        />
        <div className="absolute bottom-0 left-0 right-0 p-16 z-20 text-white">
          <h2 className="text-4xl font-extrabold mb-4 font-headline leading-snug" dangerouslySetInnerHTML={{ __html: t("side_title") }} />
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">
            {t("side_desc")}
          </p>
        </div>
      </div>
    </div>
  )
}
