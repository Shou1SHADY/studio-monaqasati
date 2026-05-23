"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { useUser } from "@/firebase";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { user } = useUser();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordStrength = (pw: string) => {
    if (pw.length === 0) return null;
    if (pw.length < 6) return { level: "ضعيفة", color: "bg-red-400", width: "w-1/4" };
    if (pw.length < 8) return { level: "متوسطة", color: "bg-amber-400", width: "w-2/4" };
    if (pw.length < 12 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return { level: "جيدة", color: "bg-blue-400", width: "w-3/4" };
    return { level: "قوية", color: "bg-emerald-500", width: "w-full" };
  };

  const strength = passwordStrength(newPassword);

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("كلمتا المرور الجديدتان غير متطابقتين.");
      return;
    }
    if (newPassword.length < 8) {
      setError("يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل.");
      return;
    }
    if (!user || !user.email) {
      setError("لا يوجد مستخدم مسجل دخول.");
      return;
    }

    setLoading(true);
    try {
      // Re-authenticate first — required by Firebase before sensitive operations
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Now update the password
      await updatePassword(user, newPassword);

      setSuccess(true);
      setTimeout(() => handleClose(), 2000);
    } catch (err: any) {
      switch (err.code) {
        case "auth/wrong-password":
        case "auth/invalid-credential":
          setError("كلمة المرور الحالية غير صحيحة. يرجى المحاولة مجدداً.");
          break;
        case "auth/too-many-requests":
          setError("تم تجاوز عدد المحاولات. يرجى الانتظار قليلاً ثم المحاولة.");
          break;
        case "auth/weak-password":
          setError("كلمة المرور الجديدة ضعيفة جداً. استخدم 8 أحرف على الأقل.");
          break;
        case "auth/requires-recent-login":
          setError("انتهت صلاحية الجلسة. يرجى تسجيل الخروج ثم الدخول مجدداً.");
          break;
        default:
          setError("حدث خطأ غير متوقع. يرجى المحاولة مجدداً.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md w-full text-right" dir="rtl">
        <DialogHeader className="pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <KeyRound size={20} />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">تغيير كلمة المرور</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                أدخل كلمة مرورك الحالية ثم اختر كلمة مرور جديدة
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <div>
              <p className="font-bold text-lg text-slate-800">تم تغيير كلمة المرور بنجاح!</p>
              <p className="text-sm text-muted-foreground mt-1">سيتم إغلاق هذه النافذة تلقائياً...</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="current-password" className="font-bold text-sm">
                كلمة المرور الحالية
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="أدخل كلمة مرورك الحالية"
                  className="h-11 pr-4 pl-10 text-right"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 transition-colors"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="font-bold text-sm">
                كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  className="h-11 pr-4 pl-10 text-right"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 transition-colors"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {/* Strength Meter */}
              {strength && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${strength.color} ${strength.width}`} />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-bold">
                    قوة كلمة المرور: <span className="text-slate-700">{strength.level}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="font-bold text-sm">
                تأكيد كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور الجديدة"
                  className="h-11 pr-4 pl-10 text-right"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 transition-colors"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                {confirmPassword && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {newPassword === confirmPassword ? (
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    ) : (
                      <AlertCircle size={16} className="text-red-400" />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter className="flex flex-col gap-2 pt-2">
              <Button
                type="submit"
                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                className="w-full h-11 rounded-xl font-bold"
              >
                {loading ? (
                  <><Loader2 size={16} className="animate-spin ml-2" /> جاري الحفظ...</>
                ) : (
                  <><KeyRound size={16} className="ml-2" /> تحديث كلمة المرور</>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 rounded-xl font-bold"
                onClick={handleClose}
                disabled={loading}
              >
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
