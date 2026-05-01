
"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { 
  Building2, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  FileCheck,
  CheckCircle2,
  ShieldCheck
} from "lucide-react"

export default function ContractorProfilePage() {
  const [profile, setProfile] = useState({
    name: "شركة المقاولات الحديثة",
    crNumber: "1010123456",
    description: "شركة مقاولات سعودية رائدة متخصصة في المشاريع السكنية والتجارية الكبرى. نلتزم بأعلى معايير الجودة والسرعة في التنفيذ.",
    location: "الرياض، المملكة العربية السعودية",
    phone: "011-222-3344",
    email: "info@modern-contracting.sa",
    website: "www.modern-contracting.sa"
  })

  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-right space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">ملف المقاول</h1>
          <p className="text-muted-foreground mt-1">إدارة بيانات شركتك التعريفية ومعلومات التواصل</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 size={20} className="text-primary" />
                  المعلومات الأساسية
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">اسم الشركة</Label>
                    <Input id="name" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cr">رقم السجل التجاري</Label>
                    <Input id="cr" value={profile.crNumber} readOnly className="bg-slate-50" />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="desc">نبذة عن الشركة</Label>
                  <Textarea 
                    id="desc" 
                    rows={4} 
                    value={profile.description} 
                    onChange={e => setProfile({...profile, description: e.target.value})} 
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="phone">رقم الهاتف</Label>
                    <div className="relative">
                      <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input id="phone" className="pr-10" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input id="email" className="pr-10" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t bg-slate-50/50 justify-end p-4">
                <Button className="gap-2">
                  حفظ التغييرات
                  <CheckCircle2 size={18} />
                </Button>
              </CardFooter>
            </Card>

            <Card className="shadow-sm border-none">
              <CardHeader className="border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileCheck size={20} className="text-primary" />
                  التوثيقات والشهادات
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between p-4 bg-success/5 border border-success/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="text-success" size={24} />
                    <div>
                      <p className="font-bold text-slate-800">السجل التجاري موثق</p>
                      <p className="text-xs text-muted-foreground">تم التحقق من بيانات الشركة من قبل الإدارة</p>
                    </div>
                  </div>
                  <Badge className="bg-success text-white">نشط</Badge>
                </div>
                
                <div className="p-4 border border-dashed rounded-lg flex flex-col items-center justify-center py-8 text-center gap-2">
                  <p className="text-sm text-muted-foreground">هل لديك شهادات جودة (ISO) أو تصنيفات أخرى؟</p>
                  <Button variant="outline" size="sm">إضافة مستند جديد</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-sm border-none bg-primary text-white">
              <CardContent className="p-6 space-y-4 text-center">
                <div className="h-24 w-24 rounded-full bg-white/20 flex items-center justify-center mx-auto border-4 border-white/10">
                  <Building2 size={48} />
                </div>
                <div>
                  <h3 className="font-bold text-xl">{profile.name}</h3>
                  <Badge className="mt-2 bg-white/20 text-white border-none">مقاول معتمد</Badge>
                </div>
                <div className="pt-4 flex flex-col gap-2 text-sm text-white/80">
                  <div className="flex items-center justify-between">
                    <span>تاريخ الانضمام</span>
                    <span className="font-bold">يناير 2024</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>إجمالي المناقصات</span>
                    <span className="font-bold">12 مناقصة</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-100">
              <CardHeader className="pb-2">
                <CardTitle className="text-md font-bold">معلومات التواصل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  <MapPin size={16} className="text-primary shrink-0" />
                  <span className="text-slate-600">{profile.location}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Globe size={16} className="text-primary shrink-0" />
                  <span className="text-slate-600">{profile.website}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
