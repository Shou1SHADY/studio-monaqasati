import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, ShoppingCart, ArrowLeft, CheckCircle2, FileCheck, MapPin, Phone, Mail } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans text-right" dir="rtl">
      {/* Navigation */}
      <nav className="w-full bg-white/95 backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center font-bold text-2xl text-white shadow-lg">م</div>
            <span className="text-2xl font-bold text-foreground font-headline tracking-tight">مناقصتي</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-foreground/70 font-medium text-sm">
            <Link href="#features" className="hover:text-primary transition-colors">المميزات</Link>
            <Link href="/register?role=Supplier" className="hover:text-primary transition-colors">انضم كمورد</Link>
            <Link href="/register?role=Contractor" className="hover:text-primary transition-colors">انضم كمقاول</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="font-bold text-foreground hover:text-primary hover:bg-primary/5">
                تسجيل الدخول
              </Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-cta hover:bg-cta/90 shadow-lg px-6 rounded-lg">
                حساب جديد
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 flex flex-col-reverse lg:flex-row items-center gap-16">
          {/* Text Content */}
          <div className="flex-1 space-y-8">
            <h1 className="text-4xl md:text-5xl lg:text-5xl font-black text-foreground font-headline leading-tight">
              منصة <span className="text-cta">مناقصتي</span> شريكك الأمثل لتوريد مواد البناء
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
              نربط أكبر المقاولين في المملكة العربية السعودية بالموردين المعتمدين. تضمن لك منصتنا الشفافية الكاملة والكفاءة العالية في إدارة طلبات عروض الأسعار.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <Link href="/register" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto h-12 px-8 text-base font-bold rounded-lg bg-primary hover:bg-primary/90 shadow-lg gap-2">
                  ابدأ الآن
                  <ArrowLeft size={18} />
                </Button>
              </Link>
              <Link href="#features" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto h-12 px-8 text-base font-bold rounded-lg border-2 border-foreground/30 text-foreground hover:bg-primary hover:text-white hover:border-primary">
                  اكتشف المميزات
                </Button>
              </Link>
            </div>
          </div>

          {/* Image/Visual */}
          <div className="flex-1 relative w-full lg:max-w-lg">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-border">
              <img
                src="/images/hero-bg.png"
                alt="منصة مناقصتي - منصة المشتريات الإنشائية"
                className="w-full h-auto object-cover aspect-[4/3]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground font-headline mb-4">حلول متكاملة لقطاع المقاولات</h2>
            <p className="text-muted-foreground">منصة موثوقة تلبي احتياجات جميع أطراف عملية المشتريات</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border border-border bg-white hover:shadow-xl transition-all duration-300 group">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-6 group-hover:bg-primary group-hover:text-white transition-colors">
                  <Building2 size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-foreground">للمقاولين</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  اطرح مناقصاتك بدقائق، وحدد شروطك بدقة، واستقبل عروض الأسعار من مئات الموردين المعتمدين.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> مقارنة آلية للأسعار والخدمات</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> إدارة شاملة للموردين</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> توثيق كامل للعقود</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> متابعة تلقائية للحالات</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border border-border bg-white hover:shadow-xl transition-all duration-300 group">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-success/10 rounded-xl flex items-center justify-center text-success mb-6 group-hover:bg-success group-hover:text-white transition-colors">
                  <ShoppingCart size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-foreground">للموردين</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  استقبل طلبات عروض الأسعار من مقاولين موثوقين، وقدم عروضك التنافسية بسهولة تامة.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> وصول مباشر للمناقصات الجديدة</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> نظام تقييمtransparent</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> عقود موحدة وآمنة</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 size={16} className="text-success" /> دفعات آمنة عبر المنصة</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border border-border bg-gradient-to-br from-primary to-primary/90 text-white">
              <CardContent className="p-8">
                <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center text-white mb-6">
                  <FileCheck size={28} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-white">للمسؤولين</h3>
                <p className="text-slate-300 leading-relaxed mb-6">
                  لوحة تحكم شاملة لرصد الأداء وتحليل البيانات واتخاذ القرارات المبنية على الأرقام.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-200"><CheckCircle2 size={16} className="text-white" /> إحصائيات شاملة</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-200"><CheckCircle2 size={16} className="text-white" /> إدارة المستخدمين</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-200"><CheckCircle2 size={16} className="text-white" /> تقارير تفصيلية</li>
                  <li className="flex items-center gap-2 text-sm font-medium text-slate-200"><CheckCircle2 size={16} className="text-white" /> التحقق من الشهادات</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-primary text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-4">ابدأ رحلتك الرقمية الآن</h2>
          <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
            انضم إلى المنصة وحوّل مشترياتك إلى عملية رقمية متكاملة.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button className="h-14 px-10 text-lg font-bold rounded-lg bg-white text-primary hover:bg-slate-100 gap-2">
                إنشاء حساب مجاني
                <ArrowLeft size={20} />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" className="h-14 px-10 text-lg font-bold rounded-lg border-white/30 text-white hover:bg-white/10">
                تسجيل الدخول
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 py-16 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-xl">م</div>
              <span className="text-xl font-bold text-white font-headline tracking-tight">مناقصتي</span>
            </div>
            <p className="text-sm leading-relaxed max-w-md mb-6">
              المنصة الرائدة في المملكة العربية السعودية لربط المقاولين بالموردين في قطاع الإنشاءات والبناء. نوفر الشفافية والكفاءة في كل عملية شراء.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={16} />
                <span>الرياض، المملكة العربية السعودية</span>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6">روابط سريعة</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/login" className="hover:text-white transition-colors">تسجيل الدخول</Link></li>
              <li><Link href="/register" className="hover:text-white transition-colors">إنشاء حساب جديد</Link></li>
              <li><Link href="#" className="hover:text-white transition-colors">سياسة الخصوصية</Link></li>
              <li><Link href="#" className="hover:text-white transition-colors">الشروط والأحكام</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6">تواصل معنا</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2">
                <Phone size={16} />
                <span>966-11-000-0000</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail size={16} />
                <span>info@monaqasati.sa</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-slate-900 text-center text-sm">
          جميع الحقوق محفوظة © {new Date().getFullYear()} منصة مناقصتي
        </div>
      </footer>
    </div>
  );
}