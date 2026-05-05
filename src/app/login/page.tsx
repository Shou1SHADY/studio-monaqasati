"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useFirebase } from "@/firebase"
import { signInWithEmailAndPassword } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowRight, Building2, CheckCircle2 } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const { auth, firestore } = useFirebase()
  const { toast } = useToast()
  
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  })

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!auth || !firestore) return

    setIsLoading(true)
    try {
      const userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password)
      const user = userCredential.user

      const userDoc = await getDoc(doc(firestore, "users", user.uid))
      
      if (!userDoc.exists()) {
        throw new Error("بيانات المستخدم غير موجودة في النظام")
      }

      const userData = userDoc.data()
      const role = userData.role

      toast({
        title: "تم تسجيل الدخول بنجاح",
        description: `مرحباً بك مجدداً، ${userData.name || "عزيزي المستخدم"}`,
      })

      if (role === "Admin") {
        router.push("/admin")
      } else if (role === "Contractor") {
        router.push("/contractor")
      } else if (role === "Supplier") {
        router.push("/supplier")
      } else {
        throw new Error("صلاحية غير معروفة")
      }
      
    } catch (error: any) {
      let errorMsg = error.message || "حدث خطأ أثناء تسجيل الدخول"
      if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
        errorMsg = "البريد الإلكتروني أو كلمة المرور غير صحيحة"
      }
      
      toast({
        title: "فشل تسجيل الدخول",
        description: errorMsg,
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen bg-background flex" dir="rtl">
      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col px-6 md:px-16 lg:px-24 xl:px-32 relative overflow-y-auto py-6">
        {/* Navbar inside form area */}
        <div className="flex items-center justify-between w-full mb-8 shrink-0">
          <Link href="/" className="flex items-center gap-2 group text-muted-foreground hover:text-foreground transition-colors">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform" />
            <span className="font-bold text-sm">العودة للرئيسية</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-base">م</div>
            <span className="text-xl font-bold text-foreground font-headline tracking-tight">مدماك تيك</span>
          </div>
        </div>

        {/* Login Form */}
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto">
          <div className="mb-10 text-right">
            <h1 className="text-3xl font-extrabold text-foreground mb-3 font-headline">تسجيل الدخول</h1>
            <p className="text-muted-foreground text-sm">أهلاً بعودتك! الرجاء إدخال بيانات الدخول الخاصة بك.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground font-bold">البريد الإلكتروني</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                placeholder="name@company.com"
                className="text-left dir-ltr h-12 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-foreground font-bold">كلمة المرور</Label>
                <Link href="#" className="text-sm font-semibold text-cta hover:text-cta/80 transition-colors">
                  نسيت كلمة المرور؟
                </Link>
              </div>
              <Input 
                id="password" 
                type="password" 
                required 
                placeholder="••••••••"
                className="text-left dir-ltr h-12 rounded-lg bg-muted border-border focus:ring-2 focus:ring-cta focus:border-cta"
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>

            <Button type="submit" className="w-full h-12 text-base font-bold rounded-lg mt-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all" disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : "تسجيل الدخول"}
            </Button>
          </form>

          <p className="mt-10 text-center text-sm text-muted-foreground">
            ليس لديك حساب بعد؟{" "}
            <Link href="/register" className="text-primary font-semibold hover:text-primary/80 transition-colors">
              أنشئ حساباً جديداً
            </Link>
          </p>
        </div>
      </div>

      {/* Left Side - Image */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/images/hero-bg.png"
          alt="منصة مدماك تيك"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 z-10">
          <h2 className="text-3xl font-bold text-white mb-4 font-headline">
            إدارة المشتريات أصبحت أسهل
          </h2>
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">
            انضم إلى مئات المقاولين والموردين المعتمدين في قطاع الإنشاءات السعودي
          </p>
        </div>
      </div>
    </div>
  )
}
