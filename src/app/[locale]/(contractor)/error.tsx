'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { isTransientLoadError, mayAutoRetry, refreshFailedChunk, reloadAfterLoadError } from '@/lib/transient-error';

const RETRY_KEY = 'mdmak:auto-retry-at';

export default function ContractorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Portal.Errors');
  const locale = useLocale();
  // A page that failed to load (a cut connection) is retried once by itself before anything is shown.
  const transient = isTransientLoadError(error);
  const [retrying, setRetrying] = useState(transient);
  useEffect(() => {
    if (!transient) return;
    let last: number | null = null;
    try { last = Number(sessionStorage.getItem(RETRY_KEY)) || null; } catch { /* storage blocked */ }
    if (!mayAutoRetry(last, Date.now())) { setRetrying(false); return; }
    try { sessionStorage.setItem(RETRY_KEY, String(Date.now())); } catch { /* storage blocked */ }
    // A broken chunk is fetched again first — otherwise the retry re-runs the cached copy.
    let shown: number | undefined;
    let live = true;
    void refreshFailedChunk(error).finally(() => {
      if (!live) return;
      reset();
      // If the retry fails in the same boundary, the message appears instead of a blank page.
      shown = window.setTimeout(() => setRetrying(false), 4000);
    });
    return () => { live = false; window.clearTimeout(shown); };
  }, [transient, reset, error]);

  if (retrying) return null;

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Card className="max-w-md w-full glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-black">{t('contractor_error_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            {transient ? t('load_failed') : t('error_apology')}
          </p>
          {error?.message && !transient && (
            <p className="text-xs text-destructive bg-destructive/5 p-2 rounded-lg">
              {error.message}
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={transient ? () => reloadAfterLoadError(error) : reset} className="font-bold">
              {transient ? t('reload') : t('retry')}
            </Button>
            <Button variant="outline" onClick={() => window.history.back()}>
              {t('back')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
