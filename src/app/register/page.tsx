"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useFirebase } from "@/firebase"
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup, sendEmailVerification } from "firebase/auth"
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Loader2, ArrowRight, Building2, ShoppingCart, ChevronDown, X, Check } from "lucide-react"
import { PREDEFINED_CATEGORIES } from "@/lib/constants"

export default function RegisterPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [registerError, setRegisterError] = useState("")
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    crNumber: "",
    taxNumber: "",
    city: "",
    role: "Contractor" as "Contractor" | "Supplier",
    specializations: [] as string[]
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      const roleParam = params.get("role")
      const emailParam = params.get("email")
      const nameParam = params.get("name")
      setFormData(prev => ({
        ...prev,
        role: (roleParam === "Supplier" || roleParam === "Contractor") ? roleParam : prev.role,
        email: emailParam || prev.email,
        name: nameParam || prev.name
      }))
    }
  }, [])

  const [specDropdownOpen, setSpecDropdownOpen] = useState(false)

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
        throw { code: "auth/weak-password", message: "كلمة المرور يجب أن تتكون من 6 أحرف على الأقل." }
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

      await setDoc(doc(firestore, "users", user.uid), {
        id: user.uid,
        name: formData.name,
        email: emailLower,
        phone: formData.phone,
        crNumber: formData.crNumber,
        taxNumber: formData.taxNumber,
        city: formData.city,
        role: role,
        organizationId: organizationId,
        organizationRole: organizationRole,
        specializations: role === "Supplier" ? formData.specializations : [],
        isVerified: false,
        profileCompleted: false,
        joinedAt: new Date().toISOString()
      })

      if (inviteSnap.exists()) {
        await deleteDoc(inviteRef)
      }

      toast({
        title: "تم إنشاء الحساب بنجاح",
        description: "يرجى تفعيل حسابك من خلال رابط التفعيل المرسل إلى بريدك الإلكتروني.",
      })

      router.push("/verify-email")

    } catch (error: any) {
      console.error("❌ Registration error:", error)
      let errorMsg = error.message || "حدث خطأ غير متوقع"
      if (error.code === "auth/email-already-in-use") errorMsg = "البريد الإلكتروني مسجل مسبقاً"
      if (error.code === "auth/weak-password") errorMsg = "كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل."
      if (error.code === "auth/invalid-email") errorMsg = "البريد الإلكتروني غير صحيح"

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
        toast({
          title: "مرحباً بعودتك",
          description: "لديك حساب مسبقاً، تم تسجيل دخولك بنجاح.",
        })
        const existingData = userDocSnap.data()
        if (existingData.role === "Contractor") router.push("/contractor")
        else router.push("/supplier")
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

      await setDoc(userDocRef, {
        id: user.uid,
        name: formData.name || user.displayName || "مستخدم جديد",
        email: emailLower,
        phone: formData.phone || "",
        crNumber: formData.crNumber || "",
        taxNumber: formData.taxNumber || "",
        city: formData.city || "",
        role: role,
        organizationId: organizationId,
        organizationRole: organizationRole,
        specializations: role === "Supplier" ? formData.specializations : [],
        isVerified: false,
        profileCompleted: false,
        joinedAt: new Date().toISOString()
      })

      if (inviteSnap.exists()) {
        await deleteDoc(inviteRef)
      }

      toast({
        title: "تم إنشاء الحساب بنجاح",
        description: "مرحباً بك في منصة مدماك تيك عبر Google!",
      })

      if (role === "Contractor") {
        router.push("/contractor")
      } else {
        router.push("/supplier")
      }
    } catch (error: any) {
      console.error("❌ Google Registration error:", error)
      toast({
        title: "فشل التسجيل",
        description: error.message || "حدث خطأ أثناء التسجيل بواسطة Google",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen bg-white flex" dir="rtl">
      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col px-6 md:px-16 lg:px-24 xl:px-32 relative overflow-y-auto py-6">
        {/* Navbar inside form area */}
        <div className="flex items-center justify-between w-full mb-8 shrink-0">
          <Link href="/" className="flex items-center gap-2 group text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform" />
            <span className="font-bold text-sm">العودة للرئيسية</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-base shadow-lg shadow-primary/20">م</div>
            <span className="text-xl font-bold text-slate-800 font-headline tracking-tight">مدماك تيك</span>
          </div>
        </div>

        {/* Register Form */}
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto py-8">
          <div className="mb-8 text-right">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-3 font-headline">حساب جديد</h1>
            <p className="text-slate-500 text-sm">انضم الآن إلى منصة مدماك تيك وابدأ بتوسيع أعمالك.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-6">
            {registerError && (
              <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg border border-destructive/20 flex items-start gap-2">
                <X className="w-5 h-5 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}
            <div className="space-y-3">
              <Label className="text-slate-700 font-bold">طبيعة نشاطك</Label>
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
                    <span className="font-bold text-sm">مقاول</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="Supplier" id="supplier" className="peer sr-only" />
                  <Label
                    htmlFor="supplier"
                    className="flex flex-col items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 hover:bg-slate-50 peer-data-[state=checked]:border-success peer-data-[state=checked]:bg-success/5 cursor-pointer transition-all"
                  >
                    <ShoppingCart className="mb-2 h-6 w-6 text-success" />
                    <span className="font-bold text-sm">مورد</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-slate-700 font-bold">اسم الشركة أو المؤسسة</Label>
              <Input
                id="name"
                required
                placeholder="أدخل الاسم التجاري"
                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="crNumber" className="text-slate-700 font-bold">رقم السجل التجاري</Label>
                <Input
                  id="crNumber"
                  required
                  placeholder="مثال: 1010XXXXXX"
                  className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                  value={formData.crNumber}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '')
                    setFormData({ ...formData, crNumber: val })
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxNumber" className="text-slate-700 font-bold">الرقم الضريبي</Label>
                <Input
                  id="taxNumber"
                  required
                  placeholder="مثال: 3XXXXXXXXXXXXXX"
                  className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                  value={formData.taxNumber || ""}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '')
                    setFormData({ ...formData, taxNumber: val })
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="city" className="text-slate-700 font-bold">المدينة (اختياري)</Label>
              <Input
                id="city"
                placeholder="مثال: الرياض"
                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.city}
                onChange={e => setFormData({ ...formData, city: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-slate-700 font-bold">رقم الجوال للتواصل</Label>
              <Input
                id="phone"
                required
                type="tel"
                placeholder="05XXXXXXXX"
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
                <Label className="text-slate-700 font-bold">تخصصات التوريد (اختر تخصصاً واحداً على الأقل)</Label>

                {/* Multiselect Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSpecDropdownOpen(prev => !prev)}
                    className={`w-full flex items-center justify-between h-12 px-4 rounded-xl border-2 bg-slate-50 text-right transition-colors ${formData.specializations.length === 0
                        ? "border-slate-200 text-slate-400"
                        : "border-primary/40 text-slate-800"
                      } hover:border-primary/60`}
                  >
                    <span className="text-sm truncate">
                      {formData.specializations.length === 0
                        ? "اختر التخصصات..."
                        : `${formData.specializations.length} تخصص مختار`}
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${specDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {specDropdownOpen && (
                    <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                        {PREDEFINED_CATEGORIES.map(cat => {
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
                              <span className={isSelected ? "font-bold text-primary" : "text-slate-700"}>{cat}</span>
                            </button>
                          )
                        })}
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
                  <p className="text-xs text-destructive font-bold">يجب اختيار تخصص واحد على الأقل لتتمكن من استقبال المناقصات.</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-bold">البريد الإلكتروني</Label>
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
              <Label htmlFor="password" className="text-slate-700 font-bold">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                required
                placeholder="••••••••"
                className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 text-white transition-all"
              disabled={isLoading || (formData.role === "Supplier" && formData.specializations.length === 0)}
            >
              {isLoading ? <Loader2 className="animate-spin" /> : "تأكيد التسجيل"}
            </Button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <span className="relative bg-white px-3 text-xs text-muted-foreground font-bold">أو عبر</span>
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
            التسجيل بواسطة Google
          </Button>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            لديك حساب مسبقاً؟{" "}
            <Link href="/login" className="text-cta font-bold hover:underline">
              سجل الدخول الآن
            </Link>
          </p>
        </div>
      </div>

      {/* Left Side - Image/Artwork */}
      <div className="hidden lg:flex flex-1 relative bg-slate-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent z-10" />
        <img
          src="/images/loading-dock.jpg"
          alt="Monaqasati Platform Architecture"
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
        <div className="absolute bottom-0 left-0 right-0 p-16 z-20 text-white">
          <h2 className="text-4xl font-extrabold mb-4 font-headline leading-snug">
            شراكات استراتيجية <br /> لنمو أعمالك بشكل أسرع.
          </h2>
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">
            المنصة التي صُممت لدفع عجلة قطاع التشييد والبناء، وتسهيل الصفقات للجميع.
          </p>
        </div>
      </div>
    </div>
  )
}
