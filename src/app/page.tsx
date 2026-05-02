import Link from 'next/link';
import Image from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, ShoppingCart, ShieldCheck, ChevronLeft, ArrowLeft, BarChart3, Clock, CheckCircle2 } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-right" dir="rtl">
      {/* Navigation */}
      <nav className="w-full bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary text-white rounded-xl flex items-center justify-center font-bold text-xl shadow-lg shadow-primary/20">م</div>
            <span className="text-2xl font-bold text-slate-800 font-headline tracking-tight">مناقصتي</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-slate-600 font-medium">
            <Link href="#features" className="hover:text-primary transition-colors">المميزات</Link>
            <Link href="/register" className="hover:text-primary transition-colors">انضم كمورد</Link>
            <Link href="/register" className="hover:text-primary transition-colors">انضم كمقاول</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="font-bold text-slate-700 hover:text-primary hover:bg-primary/5">
                تسجيل الدخول
              </Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 px-6 rounded-full">
                حساب جديد
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-white">
        <div className="absolute inset-0 bg-gradient-to-l from-slate-50/80 to-white/20 z-10" />
        <div className="max-w-7xl mx-auto px-6 pt-8 md:pt-12 pb-28 flex flex-col-reverse lg:flex-row items-center gap-16 relative z-20">

          {/* Text Content */}
          <div className="flex-1 space-y-8 text-center lg:text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 font-medium text-sm border border-blue-100 mb-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
              </span>
              المنصة الأولى لإدارة المشتريات
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-900 font-headline" style={{ lineHeight: '1.6' }}>
              أسرع طريقة لربط <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-600">المقاولين</span> مع أفضل الموردين.
            </h1>

            <p className="text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto lg:mx-0">
              بيئة رقمية متكاملة لتبسيط عملية طلب عروض الأسعار (RFQ)، أتمتة المقارنات، واتخاذ قرارات التوريد بأعلى كفاءة وشفافية في قطاع التشييد والبناء.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start pt-4">
              <Link href="/register" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto h-14 px-8 text-lg font-bold rounded-full bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20 gap-2 transition-all hover:scale-105">
                  ابدأ الآن مجاناً
                  <ArrowLeft size={20} />
                </Button>
              </Link>
              <Link href="#features" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto h-14 px-8 text-lg font-bold rounded-full border-2 hover:bg-slate-50 transition-all">
                  كيف تعمل المنصة؟
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-6 pt-10 border-t border-slate-100 mt-8">
              <div>
                <p className="text-3xl font-black text-slate-900">+500</p>
                <p className="text-sm text-slate-500 font-medium mt-1">مورد معتمد</p>
              </div>
              <div>
                <p className="text-3xl font-black text-slate-900">48 <span className="text-xl">ساعة</span></p>
                <p className="text-sm text-slate-500 font-medium mt-1">متوسط الرد</p>
              </div>
              <div>
                <p className="text-3xl font-black text-slate-900">100%</p>
                <p className="text-sm text-slate-500 font-medium mt-1">شفافية للمناقصات</p>
              </div>
            </div>
          </div>

          {/* Image */}
          <div className="flex-1 relative w-full lg:max-w-xl">
            <div className="relative rounded-2xl overflow-hidden shadow-xl border border-slate-100/50">
              <img
                src="/images/hero-bg.png"
                alt="Monaqasati Platform"
                className="w-full h-auto object-cover aspect-video lg:aspect-[4/3]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent flex items-end">
                <div className="p-6 text-white w-full backdrop-blur-sm bg-black/10">
                  <p className="font-bold text-lg">منصة موثوقة بمعايير احترافية</p>
                  <p className="text-sm opacity-90 mt-1">نربط المشاريع الكبرى بأفضل الموردين في المملكة</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 font-headline mb-4">كل ما تحتاجه لإدارة مشترياتك</h2>
            <p className="text-lg text-slate-600">صُممت المنصة لتلبي احتياجات قطاع المقاولات بتوفير أدوات قوية وسهلة الاستخدام.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-none shadow-lg shadow-slate-200/50 hover:-translate-y-1 transition-transform duration-300">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
                  <Building2 size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-slate-900">للمقاولين</h3>
                <p className="text-slate-600 leading-relaxed mb-6">
                  اطرح مناقصاتك بدقائق، حدد شروطك، واستقبل عروض الأسعار من مئات الموردين المعتمدين محلياً.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> مقارنة آلية للأسعار</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> إدارة الموردين المفضلين</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> تتبع حالة الطلبات والمحادثات</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg shadow-slate-200/50 hover:-translate-y-1 transition-transform duration-300">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-success/10 rounded-2xl flex items-center justify-center text-success mb-6">
                  <ShoppingCart size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-slate-900">للموردين</h3>
                <p className="text-slate-600 leading-relaxed mb-6">
                  استقبل طلبات عروض الأسعار (RFQs) الحقيقية من مقاولين موثوقين، وقدم عروضك التنافسية بسهولة.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> زيادة المبيعات بشكل ملحوظ</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> تنبيهات فورية بالطلبات الجديدة</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-700"><CheckCircle2 size={16} className="text-success" /> بناء سمعة وتقييم عالي بالمنصة</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg shadow-slate-200/50 hover:-translate-y-1 transition-transform duration-300 bg-slate-900 text-white">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-white mb-6">
                  <BarChart3 size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-white">تحليل البيانات (قريباً)</h3>
                <p className="text-slate-300 leading-relaxed mb-6">
                  مؤشرات أسعار مواد البناء، تقارير تحليلية للسوق، وتوقعات للميزانيات بناءً على بيانات ضخمة.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-300"><Clock size={16} className="text-blue-400" /> مؤشر الأسعار اللحظي</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-300"><Clock size={16} className="text-blue-400" /> تقارير أداء المشتريات</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-lg">م</div>
              <span className="text-xl font-bold text-white font-headline tracking-tight">مناقصتي</span>
            </div>
            <p className="text-sm leading-relaxed max-w-sm">
              نسعى لرقمنة قطاع الإنشاءات في المملكة وتسهيل ربط المقاولين بالموردين لزيادة الكفاءة والشفافية.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4">روابط سريعة</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/login" className="hover:text-primary transition-colors">تسجيل الدخول</Link></li>
              <li><Link href="/register" className="hover:text-primary transition-colors">إنشاء حساب جديد</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">الشروط والأحكام</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4">تواصل معنا</h4>
            <ul className="space-y-2 text-sm">
              <li>الرياض، المملكة العربية السعودية</li>
              <li>info@monaqasati.sa</li>
              <li>966-50-000-0000+</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-slate-800 text-center text-sm">
          جميع الحقوق محفوظة &copy; {new Date().getFullYear()} منصة مناقصتي
        </div>
      </footer>
    </div>
  );
}
