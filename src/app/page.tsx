import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, ShoppingCart, ShieldCheck, ChevronLeft } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-right">
      <header className="max-w-4xl w-full mb-12 text-center">
        <h1 className="text-5xl font-bold text-secondary mb-4 font-headline">مناقصتي</h1>
        <p className="text-xl text-muted-foreground">المنصة الأولى لربط المقاولين بالموردين في قطاع الإنشاءات</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
        {/* Contractor Section */}
        <Card className="hover:shadow-lg transition-shadow border-2 border-primary/20">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
              <Building2 size={32} />
            </div>
            <CardTitle className="text-2xl font-bold">بوابة المقاولين</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              اطرح مناقصاتك (RFQs)، قارن الأسعار، وتواصل مع أفضل الموردين المعتمدين في جميع تخصصات البناء.
            </p>
            <Link href="/contractor" className="block">
              <Button className="w-full h-12 text-lg font-medium bg-primary hover:bg-primary/90">
                دخول المقاولين
                <ChevronLeft className="mr-2 h-5 w-5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Supplier Section */}
        <Card className="hover:shadow-lg transition-shadow border-2 border-success/20">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4 text-success">
              <ShoppingCart size={32} />
            </div>
            <CardTitle className="text-2xl font-bold">بوابة الموردين</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              استقبل طلبات عرض السعر، قدم عروضك، ووسع شبكة عملائك من المقاولين في جميع أنحاء المملكة.
            </p>
            <Link href="/supplier" className="block">
              <Button className="w-full h-12 text-lg font-medium bg-success hover:bg-success/90">
                دخول الموردين
                <ChevronLeft className="mr-2 h-5 w-5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Admin Section */}
        <Card className="hover:shadow-lg transition-shadow border-2 border-secondary/20">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-secondary">
              <ShieldCheck size={32} />
            </div>
            <CardTitle className="text-2xl font-bold">بوابة الإدارة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              إدارة المستخدمين، التحقق من الموردين، متابعة نشاط المنصة وضمان سير العمل بسلاسة.
            </p>
            <Link href="/admin" className="block">
              <Button variant="outline" className="w-full h-12 text-lg font-medium border-secondary text-secondary hover:bg-secondary hover:text-white transition-colors">
                دخول المشرفين
                <ChevronLeft className="mr-2 h-5 w-5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-20 text-muted-foreground text-sm">
        جميع الحقوق محفوظة &copy; {new Date().getFullYear()} مناقصتي - المنصة المجانية لقطاع التشييد
      </footer>
    </div>
  );
}
