"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import Image from "next/image"
import { useTranslations, useLocale } from "next-intl"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { useFirebase } from "@/firebase"
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup, sendEmailVerification, type User } from "firebase/auth"
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Loader2, ArrowRight, Building2, ShoppingCart, ChevronDown, X, Check, Search, Eye, EyeOff, Mail } from "lucide-react"
import { PREDEFINED_CATEGORIES, displayCategory } from "@/lib/constants"

export default function RegisterPage() {
  const t = useTranslations("Auth.Register")
  const locale = useLocale()
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [registerError, setRegisterError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "Contractor" as "Contractor" | "Supplier",
    specializations: [] as string[]
  })

  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteInfo, setInviteInfo] = useState<
    | { type: "supplier_invite"; email: string; companyName: string | null; contractorName: string }
    | { type: "team_invite"; email: string; name: string | null; orgName: string; role: string }
    | null
  >(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      const roleParam = params.get("role")
      const emailParam = params.get("email")
      const nameParam = params.get("name")
      const inviteParam = params.get("invite")
      if (inviteParam) setInviteToken(inviteParam)
      setFormData(prev => ({
        ...prev,
        role: (roleParam === "Supplier" || roleParam === "Contractor") ? roleParam : prev.role,
        email: emailParam || prev.email,
        name: nameParam || prev.name
      }))
    }
  }, [])

  // Invitation link (?invite=<token>): prefill the form. Supplier invites lock
  // the flow onto the Supplier role; team invites carry their own role.
  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    const lookupInvite = async () => {
      try {
        const res = await fetch(`/api/invitations/lookup?token=${encodeURIComponent(inviteToken)}`)
        const data = await res.json().catch(() => null)
        if (cancelled || !res.ok || !data?.success) return
        setInviteInfo(data.data)
        if (data.data.type === "team_invite") {
          setFormData(prev => ({
            ...prev,
            role: data.data.role === "Supplier" ? "Supplier" : "Contractor",
            email: data.data.email || prev.email,
            name: prev.name || data.data.name || ""
          }))
        } else {
          setFormData(prev => ({
            ...prev,
            role: "Supplier",
            email: data.data.email || prev.email,
            name: prev.name || data.data.companyName || ""
          }))
        }
      } catch (err) {
        console.error("Failed to look up invitation:", err)
      }
    }
    lookupInvite()
    return () => { cancelled = true }
  }, [inviteToken])

  // Supplier invite → links the new supplier to the contractor's directory;
  // team invite → joins the new user to the inviting organization. Reports
  // success/failure so the caller can tell the user when it didn't work —
  // the account still exists either way, but silently pretending the link
  // succeeded leaves them stuck in their own solo org with no explanation.
  const acceptInvite = async (user: User): Promise<{ ok: boolean; code?: string }> => {
    if (!inviteToken) return { ok: true }
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token: inviteToken }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        console.error("Failed to auto-accept invitation:", data?.message || res.status)
        return { ok: false, code: data?.code }
      }
      return { ok: true }
    } catch (err) {
      console.error("Failed to auto-accept invitation:", err)
      return { ok: false }
    }
  }

  const [specDropdownOpen, setSpecDropdownOpen] = useState(false)
  const [specSearch, setSpecSearch] = useState("")
  const specDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (specDropdownRef.current && !specDropdownRef.current.contains(e.target as Node)) {
        setSpecDropdownOpen(false)
        setSpecSearch("")
      }
    }
    if (specDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [specDropdownOpen])

  const toggleSpec = (spec: string) => {
    setFormData(prev => ({
      ...prev,
      specializations: prev.specializations.includes(spec)
        ? prev.specializations.filter(s => s !== spec)
        : [...prev.specializations, spec]
    }))
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !firestore) return

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

      // Send Verification Email
      try {
        await sendEmailVerification(user)
      } catch (err) {
        console.error("Failed to send verification email:", err)
      }

      // Check for invitation
      const inviteRef = doc(firestore, "invitations", emailLower)
      const inviteSnap = await getDoc(inviteRef)

      let organizationId = user.uid
      let organizationRole = 'owner'
      let role = formData.role

      if (inviteSnap.exists()) {
        const inviteData = inviteSnap.data()
        organizationId = inviteData.organizationId
        organizationRole = inviteData.organizationRole || 'member'
        role = inviteData.role || formData.role
      }

      // Atomic: if the Firestore write fails, delete the Auth user so no
      // orphaned account is left that can neither log in nor re-register.
      try {
        await setDoc(doc(firestore, "users", user.uid), {
          id: user.uid,
          name: formData.name,
          email: emailLower,
          phone: formData.phone,
          role: role,
          organizationId: organizationId,
          organizationRole: organizationRole,
          specializations: role === "Supplier" ? formData.specializations : [],
          providers: ["password"] as string[],
          isVerified: false,
          profileCompleted: false,
          joinedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        })
      } catch (firestoreError) {
        await user.delete().catch(() => {})
        throw firestoreError
      }

      if (inviteSnap.exists()) {
        await deleteDoc(inviteRef)
      }

      // No-op without a token; the API validates type/role server-side.
      const acceptResult = await acceptInvite(user)

      if (inviteToken && !acceptResult.ok) {
        toast({
          title: t("success_title"),
          description: t("invite_accept_failed_desc"),
          variant: "destructive",
        })
      } else if (inviteToken && inviteInfo?.type === "team_invite") {
        toast({
          title: t("success_title"),
          description: t("invite_joined_team_desc", { org: inviteInfo.orgName || "" }),
        })
      } else if (inviteToken && inviteInfo?.type === "supplier_invite") {
        toast({
          title: t("success_title"),
          description: t("invite_joined_supplier_desc", { contractor: inviteInfo.contractorName || "" }),
        })
      } else {
        toast({
          title: t("success_title"),
          description: t("success_desc"),
        })
      }

      router.push("/verify-email")

    } catch (error: any) {
      let errorMsg = error.message || t("error_unexpected")
      if (error.code === "auth/email-already-in-use") errorMsg = t("error_email_in_use")
      else if (error.code === "auth/weak-password") errorMsg = t("error_weak_pwd")
      else if (error.code === "auth/invalid-email") errorMsg = t("error_invalid_email")
      else console.error("Registration error:", error)

      setRegisterError(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleRegister = async () => {
    if (!auth || !firestore) return

    setIsLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const user = result.user

      const userDocRef = doc(firestore, "users", user.uid)
      const userDocSnap = await getDoc(userDocRef)

      if (userDocSnap.exists()) {
        // Registration is explicit — do not silently log in an existing user.
        await auth.signOut()
        setRegisterError(t("err_already_registered"))
        // Also surface a toast: the Google button sits at the bottom of the
        // form, so the inline error (rendered at the top) may be off-screen.
        toast({
          title: t("google_failed"),
          description: t("err_already_registered"),
          variant: "destructive"
        })
        return
      }

      const emailLower = user.email?.toLowerCase().trim() || formData.email.toLowerCase().trim()

      const inviteRef = doc(firestore, "invitations", emailLower)
      const inviteSnap = await getDoc(inviteRef)

      let organizationId = user.uid
      let organizationRole = 'owner'
      let role = formData.role

      if (inviteSnap.exists()) {
        const inviteData = inviteSnap.data()
        organizationId = inviteData.organizationId
        organizationRole = inviteData.organizationRole || 'member'
        role = inviteData.role || formData.role
      }

      // Atomic: if the Firestore write fails, delete the Auth user so no
      // orphaned account is left that can neither log in nor re-register.
      try {
        await setDoc(userDocRef, {
          id: user.uid,
          name: formData.name || user.displayName || "مستخدم جديد",
          email: emailLower,
          phone: formData.phone || "",
          role: role,
          organizationId: organizationId,
          organizationRole: organizationRole,
          specializations: role === "Supplier" ? formData.specializations : [],
          providers: ["google.com"] as string[],
          isVerified: false,
          profileCompleted: false,
          joinedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        })
      } catch (firestoreError) {
        await user.delete().catch(() => {})
        throw firestoreError
      }

      if (inviteSnap.exists()) {
        await deleteDoc(inviteRef)
      }

      // No-op without a token; the API validates type/role server-side.
      const acceptResult = await acceptInvite(user)

      if (inviteToken && !acceptResult.ok) {
        toast({
          title: t("success_title"),
          description: t("invite_accept_failed_desc"),
          variant: "destructive",
        })
      } else if (inviteToken && inviteInfo?.type === "team_invite") {
        toast({
          title: t("success_title"),
          description: t("invite_joined_team_desc", { org: inviteInfo.orgName || "" }),
        })
      } else if (inviteToken && inviteInfo?.type === "supplier_invite") {
        toast({
          title: t("success_title"),
          description: t("invite_joined_supplier_desc", { contractor: inviteInfo.contractorName || "" }),
        })
      } else {
        toast({
          title: t("success_title"),
          description: t("google_success_desc"),
        })
      }

      if (role === "Contractor") {
        router.push("/contractor")
      } else {
        router.push("/supplier")
      }
    } catch (error: any) {
      console.error("❌ Google Registration error:", error)
      if (error.code === "auth/cancelled-popup-request" || error.code === "auth/popup-closed-by-user") {
        return
      }
      // Account with this email already exists under a different provider (password)
      if (error.code === "auth/account-exists-with-different-credential") {
        setRegisterError(t("error_email_in_use"))
        toast({
          title: t("google_failed"),
          description: t("error_email_in_use"),
          variant: "destructive"
        })
        return
      }
      toast({
        title: t("google_failed"),
        description: error.message || t("google_failed_desc"),
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
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

          <form onSubmit={handleRegister} className="space-y-6">
            {registerError && (
              <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg border border-destructive/20 flex items-start gap-2">
                <X className="w-5 h-5 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}
            <div className="space-y-3">
              <Label className="text-slate-700 font-bold">{t("role")}</Label>
              <RadioGroup
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v as "Contractor" | "Supplier" })}
                className="grid grid-cols-2 gap-3"
              >
                <div>
                  <RadioGroupItem value="Contractor" id="contractor" className="peer sr-only" />
                  <Label
                    htmlFor="contractor"
                    className="flex flex-col items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 hover:bg-slate-50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
                  >
                    <Building2 className="mb-2 h-6 w-6 text-primary" />
                    <span className="font-bold text-sm">{t("contractor")}</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="Supplier" id="supplier" className="peer sr-only" />
                  <Label
                    htmlFor="supplier"
                    className="flex flex-col items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 hover:bg-slate-50 peer-data-[state=checked]:border-success peer-data-[state=checked]:bg-success/5 cursor-pointer transition-all"
                  >
                    <ShoppingCart className="mb-2 h-6 w-6 text-success" />
                    <span className="font-bold text-sm">{t("supplier")}</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

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

            {formData.role === "Supplier" && (
              <div className="space-y-2">
                <Label className="text-slate-700 font-bold">{t("specializations")}</Label>

                {/* Multiselect Dropdown */}
                <div className="relative" ref={specDropdownRef}>
                  <button
                    type="button"
                    onClick={() => { setSpecDropdownOpen(prev => !prev); setSpecSearch("") }}
                    className={`w-full flex items-center justify-between h-12 px-4 rounded-xl border-2 bg-slate-50 text-start transition-colors ${formData.specializations.length === 0
                        ? "border-slate-200 text-slate-400"
                        : "border-primary/40 text-slate-800"
                      } hover:border-primary/60`}
                  >
                    <span className="text-sm truncate">
                      {formData.specializations.length === 0
                        ? t("select_specializations")
                        : t("selected_specializations", { count: formData.specializations.length })}
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${specDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {specDropdownOpen && (
                    <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                      <div className="px-3 pt-3 pb-2">
                        <div className="relative">
                          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <Input
                            autoFocus
                            value={specSearch}
                            onChange={e => setSpecSearch(e.target.value)}
                            placeholder={t("search_specializations")}
                            className="h-9 pl-3 pr-9 text-sm rounded-lg bg-slate-100 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                        {PREDEFINED_CATEGORIES.filter(cat => {
                          if (!specSearch.trim()) return true
                          return displayCategory(cat, locale).toLowerCase().includes(specSearch.toLowerCase().trim())
                        }).map(cat => {
                          const isSelected = formData.specializations.includes(cat)
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => toggleSpec(cat)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right hover:bg-primary/5 transition-colors ${isSelected ? "bg-primary/5" : ""
                                }`}
                            >
                              <div className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${isSelected
                                  ? "bg-primary border-primary"
                                  : "border-slate-300 bg-white"
                                }`}>
                                {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className={isSelected ? "font-bold text-primary" : "text-slate-700"}>{displayCategory(cat, locale)}</span>
                            </button>
                          )
                        })}
                        {PREDEFINED_CATEGORIES.filter(cat => {
                          if (!specSearch.trim()) return true
                          return displayCategory(cat, locale).toLowerCase().includes(specSearch.toLowerCase().trim())
                        }).length === 0 && (
                          <p className="px-4 py-3 text-sm text-slate-400">{t("no_specializations_found")}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected tags */}
                {formData.specializations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {formData.specializations.map(spec => (
                      <span
                        key={spec}
                        className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold px-2.5 py-1 rounded-full"
                      >
                        {spec}
                        <button type="button" onClick={() => toggleSpec(spec)} className="hover:text-destructive transition-colors">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {formData.specializations.length === 0 && (
                  <p className="text-xs text-destructive font-bold">{t("specialization_required")}</p>
                )}
              </div>
            )}

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
              disabled={isLoading || (formData.role === "Supplier" && formData.specializations.length === 0)}
            >
              {isLoading ? <Loader2 className="animate-spin" /> : t("confirm_register")}
            </Button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <span className="relative bg-white px-3 text-xs text-muted-foreground font-bold">{t("or_via")}</span>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 rounded-lg border border-slate-200 bg-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-bold transition-all flex items-center justify-center gap-3"
            onClick={handleGoogleRegister}
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
            {t("register_google")}
          </Button>

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
