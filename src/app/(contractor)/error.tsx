'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function ContractorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6" dir="rtl">
      <Card className="max-w-md w-full glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-black">حدث خطأ في لوحة المقاول</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            نعتذر عن هذا الخطأ. يرجى المحاولة مرة أخرى أو العودة للصفحة السابقة.
          </p>
          {error?.message && (
            <p className="text-xs text-destructive bg-destructive/5 p-2 rounded-lg">
              {error.message}
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={reset} className="font-bold">
              إعادة المحاولة
            </Button>
            <Button variant="outline" onClick={() => window.history.back()}>
              العودة
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
