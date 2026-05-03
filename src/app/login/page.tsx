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
import { Loader2, ArrowRight } from "lucide-react"

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
            <span className="text-xl font-bold text-slate-800 font-headline tracking-tight">مناقصتي</span>
          </div>
        </div>

        {/* Login Form */}
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto">
          <div className="mb-10 text-right">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-3 font-headline">تسجيل الدخول</h1>
            <p className="text-slate-500 text-sm">أهلاً بعودتك! الرجاء إدخال بيانات الدخول الخاصة بك.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-slate-700 font-bold">كلمة المرور</Label>
                <Link href="#" className="text-xs font-bold text-primary hover:underline">
                  نسيت كلمة المرور؟
                </Link>
              </div>
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
              {isLoading ? <Loader2 className="animate-spin" /> : "تسجيل الدخول"}
            </Button>
          </form>

          <p className="mt-10 text-center text-sm text-slate-500">
            ليس لديك حساب بعد؟{" "}
            <Link href="/register" className="text-primary font-bold hover:underline">
              أنشئ حساباً جديداً
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
            إدارة المشتريات <br /> أصبحت أسهل وأكثر شفافية.
          </h2>
          <p className="text-slate-300 text-lg max-w-md leading-relaxed">
            انضم إلى شبكة تضم مئات المقاولين والموردين المعتمدين واكتشف فرصاً جديدة لتنمية أعمالك.
          </p>
        </div>
      </div>
    </div>
  )
}
