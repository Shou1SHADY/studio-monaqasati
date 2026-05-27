"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { doc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { 
  Loader2, 
  ShieldCheck, 
  CheckCircle2, 
  X,
  User,
  Lock,
  Mail,
  Phone
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { sendEmailVerification } from "firebase/auth"
import { useTranslations, useLocale } from 'next-intl'

export default function AdminProfilePage() {
  const t = useTranslations("Portal.Admin.Profile")
  const locale = useLocale()
  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [profile, setProfile] = useState({
    name: "",
    phone: "",
    email: "",
    twoFactorEnabled: false
  })

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  
  const { data: userData, isLoading: isUserDataLoading } = useDoc(userDocRef)

  // Sync with user data
  useEffect(() => {
    if (userData && !profile.name) {
      setProfile({
        name: userData.name || user?.displayName || "",
        phone: userData.phone || userData.phoneNumber || "",
        email: userData.email || user?.email || "",
        twoFactorEnabled: userData.twoFactorEnabled || false
      })
    }
  }, [userData, user])

  const handleSave = async () => {
    if (!user || !firestore) return
    setIsLoading(true)

    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        name: profile.name,
        phone: profile.phone,
        phoneNumber: profile.phone,
        twoFactorEnabled: profile.twoFactorEnabled || false,
        profileCompleted: true
      })
      
      toast({ title: t("save_success_title"), description: t("save_success_desc") })
    } catch (e: any) {
      toast({ title: t("error"), description: e.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  if (isUserLoading || isUserDataLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto py-8 text-right space-y-8">
        {/* Header Section */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/5 to-transparent opacity-50 pointer-events-none" />
          
          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="flex flex-col md:flex-row items-center gap-10 flex-1">
              <div className="relative group/avatar">
                <div className="h-36 w-36 rounded-[3rem] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.15)] flex items-center justify-center overflow-hidden transition-all duration-700 group-hover/avatar:scale-110 group-hover/avatar:rotate-3 border border-slate-100">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/80 to-secondary opacity-[0.03]" />
                  <div className="h-20 w-20 rounded-[2rem] bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg transform transition-transform duration-500 group-hover/avatar:scale-110">
                    <ShieldCheck size={40} className="text-white" />
                  </div>
                </div>
              </div>

              <div className="text-center md:text-right space-y-4">
                <div className="space-y-1">
                  <Badge className="px-4 py-1 rounded-full text-[10px] font-black border-none shadow-sm mb-2 bg-primary/10 text-primary">
                    {t("sys_admin")}
                  </Badge>
                  <h1 className="text-4xl lg:text-5xl font-black text-slate-900 font-headline tracking-tighter leading-none">{profile.name || t("sys_admin_name")}</h1>
                </div>
                <div className="flex flex-wrap justify-center md:justify-start items-center gap-4 text-slate-500">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-sm">
                    <Mail size={14} className="text-primary/60" />
                    <span>{profile.email}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="sticky top-6 z-40 flex justify-end gap-3 bg-white/40 backdrop-blur-2xl p-4 rounded-[2rem] border border-white/20 shadow-xl shadow-slate-200/20 max-w-fit mr-auto">
          <Button variant="ghost" onClick={() => window.location.reload()} className="h-12 px-6 rounded-2xl hover:bg-white/50 text-slate-600 transition-all font-bold">
            <X size={18} className="ml-2" />
            {t("cancel")}
          </Button>
          <Button className="gap-2 h-12 px-10 rounded-2xl shadow-xl shadow-primary/30 bg-primary hover:bg-secondary hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 font-bold text-white ring-offset-2 ring-primary/20 hover:ring-4" onClick={handleSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
            {t("save_changes")}
          </Button>
        </div>

        <Tabs defaultValue="basic" className="space-y-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="w-full justify-start h-14 p-1 bg-slate-100/50 rounded-2xl border mb-8 overflow-x-auto overflow-y-hidden no-scrollbar">
            <TabsTrigger value="basic" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <User size={18} />
              {t("basic_info")}
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-white data-[state=active]:shadow-sm h-full px-6 rounded-xl gap-2 text-md transition-all">
              <Lock size={18} />
              {t("security_privacy")}
            </TabsTrigger>
          </TabsList>

          {/* BASIC INFO TAB */}
          <TabsContent value="basic" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <User size={22} className="text-primary" />
                  {t("admin_info")}
                </CardTitle>
                <CardDescription>{t("admin_info_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-slate-700 font-bold">{t("full_name")} <span className="text-destructive mx-1">*</span></Label>
                      <Input 
                        id="name" 
                        value={profile.name}
                        onChange={e => setProfile({...profile, name: e.target.value})}
                        className="h-11 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-slate-700 font-bold">{t("phone_number")}</Label>
                      <div className="relative">
                        <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                          id="phone" 
                          value={profile.phone}
                          onChange={e => setProfile({...profile, phone: e.target.value})}
                          className="dir-ltr text-left h-11 pr-10"
                          placeholder="+966 5x xxx xxxx"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SECURITY TAB */}
          <TabsContent value="security" className="m-0 focus-visible:outline-none">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Lock size={22} className="text-primary" />
                  {t("security_title")}
                </CardTitle>
                <CardDescription>{t("security_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                
                {/* 1. Account Provider Details */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("login_method")}</h4>
                    <p className="text-xs text-muted-foreground">{t("login_method_desc")}</p>
                  </div>
                  <Badge variant="outline" className="px-4 py-1.5 rounded-xl font-bold text-xs bg-white shadow-sm flex items-center gap-1.5">
                    {user?.providerData.some(p => p.providerId === "google.com") ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                        {t("google_connected")}
                      </>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {t("email_password")}
                      </>
                    )}
                  </Badge>
                </div>

                <Separator />

                {/* 2. Email Verification Control */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 text-right">
                    <h4 className="font-bold text-slate-800 text-sm">{t("email_verification_status")}</h4>
                    <p className="text-xs text-muted-foreground font-semibold">{profile.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {user?.emailVerified ? (
                      <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-success/10 text-success border-none shadow-sm flex items-center gap-1.5">
                        <CheckCircle2 size={14} />
                        {t("verified_active")}
                      </Badge>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <Badge className="px-4 py-1.5 rounded-xl font-bold text-xs bg-amber-100 text-amber-700 border-none shadow-sm flex items-center justify-center gap-1.5">
                          {t("not_verified")}
                        </Badge>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-9 px-4 rounded-xl text-xs font-bold bg-white"
                          onClick={async () => {
                            try {
                              if (user) {
                                await sendEmailVerification(user);
                                toast({
                                  title: t("link_sent_title"),
                                  description: t("link_sent_desc")
                                });
                              }
                            } catch (e: any) {
                              toast({
                                title: t("error"),
                                description: e.message || t("link_failed_desc"),
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          {t("send_verification_link")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* 3. 2-Step Verification Toggle */}
                <div className="p-5 rounded-2xl border bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                  <div className="space-y-1 flex-1 text-right">
                    <div className="flex items-center gap-2 justify-start">
                      <h4 className="font-bold text-slate-800 text-sm">{t("two_step_verification")}</h4>
                      <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">{t("sms_badge")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-xl leading-relaxed mt-1">
                      {t("two_step_desc", { phone: profile.phone || t("phone_required") })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={profile.twoFactorEnabled || false}
                      onCheckedChange={(checked) => {
                        if (checked && !profile.phone) {
                          toast({
                            title: t("phone_required_title"),
                            description: t("phone_required_desc"),
                            variant: "destructive"
                          });
                          return;
                        }
                        setProfile(prev => ({ ...prev, twoFactorEnabled: checked }));
                      }}
                    />
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  )
}
