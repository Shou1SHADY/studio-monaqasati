"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useFirebase } from "@/firebase"
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth"
import { doc, setDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Loader2, ArrowRight, Building2, ShoppingCart } from "lucide-react"

export default function RegisterPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()
  
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    crNumber: "",
    city: "",
    role: "Contractor" as "Contractor" | "Supplier"
  })

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !firestore) return

    setIsLoading(true)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password)
      const user = userCredential.user

      await updateProfile(user, { displayName: formData.name })

      await setDoc(doc(firestore, "users", user.uid), {
        id: user.uid,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        crNumber: formData.crNumber,
        city: formData.city,
        role: formData.role,
        isVerified: false,
        profileCompleted: false, // flag indicating they should complete extra info later
        joinedAt: new Date().toISOString()
      })

      toast({
        title: "تم إنشاء الحساب بنجاح",
        description: "مرحباً بك في منصة مناقصتي!",
      })

      if (formData.role === "Contractor") {
        router.push("/contractor")
      } else {
        router.push("/supplier")
      }
      
    } catch (error: any) {
      let errorMsg = "حدث خطأ غير متوقع"
      if (error.code === "auth/email-already-in-use") errorMsg = "البريد الإلكتروني مسجل مسبقاً"
      if (error.code === "auth/weak-password") errorMsg = "كلمة المرور ضعيفة جداً"
      
      toast({
        title: "فشل إنشاء الحساب",
        description: errorMsg,
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex" dir="rtl">
      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col px-6 md:px-16 lg:px-24 xl:px-32 relative">
        {/* Navbar inside form area */}
        <div className="h-24 flex items-center justify-between w-full">
          <Link href="/" className="flex items-center gap-2 group text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform" />
            <span className="font-bold text-sm">العودة للرئيسية</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-base shadow-lg shadow-primary/20">م</div>
            <span className="text-xl font-bold text-slate-800 font-headline tracking-tight">مناقصتي</span>
          </div>
        </div>

        {/* Register Form */}
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto py-8">
          <div className="mb-8 text-right">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-3 font-headline">حساب جديد</h1>
            <p className="text-slate-500 text-sm">انضم الآن إلى منصة مناقصتي وابدأ بتوسيع أعمالك.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            <div className="space-y-3">
              <Label className="text-slate-700 font-bold">طبيعة نشاطك</Label>
              <RadioGroup 
                defaultValue={formData.role} 
                onValueChange={(v) => setFormData({...formData, role: v as "Contractor" | "Supplier"})}
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
                onChange={e => setFormData({...formData, name: e.target.value})}
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
                  onChange={e => setFormData({...formData, crNumber: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="city" className="text-slate-700 font-bold">المدينة</Label>
                <Input 
                  id="city" 
                  required 
                  placeholder="مثال: الرياض"
                  className="h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                  value={formData.city}
                  onChange={e => setFormData({...formData, city: e.target.value})}
                />
              </div>
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
                onChange={e => setFormData({...formData, phone: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-bold">البريد الإلكتروني</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                placeholder="name@company.com"
                className="text-left dir-ltr h-12 rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
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
                onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>

            <Button type="submit" className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-primary/20 mt-4" disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : "تأكيد التسجيل"}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            لديك حساب مسبقاً؟{" "}
            <Link href="/login" className="text-primary font-bold hover:underline">
              سجل الدخول الآن
            </Link>
          </p>
        </div>
      </div>

      {/* Left Side - Image/Artwork */}
      <div className="hidden lg:flex flex-1 relative bg-slate-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent z-10" />
        <img 
          src="/images/hero-bg.png" 
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
