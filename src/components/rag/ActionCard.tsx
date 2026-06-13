'use client';

import { CheckCircle2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingAction } from '@/lib/rag-types';

interface ActionCardProps {
  action: PendingAction;
  executed?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  locale: 'ar' | 'en';
}

export function ActionCard({ action, executed, onConfirm, onDismiss, locale }: ActionCardProps) {
  const isAr = locale === 'ar';

  if (executed) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-success">
        <CheckCircle2 size={14} />
        <span>{isAr ? 'تم تنفيذ الإجراء بنجاح' : 'Action executed successfully'}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 border border-accent/25 rounded-xl p-3 bg-accent/5 w-full">
      <div className="flex items-start gap-2 mb-3">
        <Zap size={13} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-accent leading-tight">{action.label}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{action.description}</p>
        </div>
      </div>

      {/* Show key params if helpful */}
      {action.type === 'submitOffer' && action.params.price != null && (
        <div className="mb-3 px-2 py-1.5 bg-background/60 rounded-lg text-xs">
          <span className="text-muted-foreground">{isAr ? 'السعر: ' : 'Price: '}</span>
          <span className="font-semibold">{action.params.price} {isAr ? 'ر.س' : 'SAR'}</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-7 text-xs bg-accent hover:bg-accent/90 text-accent-foreground"
          onClick={onConfirm}
        >
          <CheckCircle2 size={11} className="me-1.5" />
          {isAr ? 'تأكيد' : 'Confirm'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground"
          onClick={onDismiss}
        >
          <X size={12} />
        </Button>
      </div>
    </div>
  );
}
