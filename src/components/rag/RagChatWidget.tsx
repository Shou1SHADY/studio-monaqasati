'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Send, Trash2, Sparkles, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import { useFirestore, useUser, useMemoFirebase, useDoc } from '@/firebase';
import {
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  arrayUnion,
  getDocs,
  limit,
  documentId,
} from 'firebase/firestore';
import { useRagChat } from '@/hooks/useRagChat';
import { ChatMessage } from './ChatMessage';
import type { PendingAction, RagContext } from '@/lib/rag-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function welcomeText(role: string, isAr: boolean): string {
  if (isAr) {
    if (role === 'Contractor') return 'مرحباً! يمكنني مساعدتك في إدارة طلبات العروض، مراجعة الأسعار الواردة، والبحث عن الموردين المناسبين. اسألني أي شيء!';
    if (role === 'Supplier') return 'مرحباً! يمكنني مساعدتك في البحث عن طلبات العروض المتاحة، تتبع عروضك، وتقديم عروض أسعار جديدة. اسألني أي شيء!';
    return 'مرحباً! يمكنني مساعدتك في استعراض إحصائيات المنصة وتحليل بيانات المستخدمين. اسألني أي شيء!';
  }
  if (role === 'Contractor') return "Hello! I can help you manage RFQs, review incoming offers, and find the right suppliers. Ask me anything!";
  if (role === 'Supplier') return "Hello! I can help you find available RFQs, track your offers, and submit new price proposals. Ask me anything!";
  return "Hello! I can help you review platform statistics and user data. Ask me anything!";
}

function quickPrompts(role: string, isAr: boolean): string[] {
  if (isAr) {
    if (role === 'Contractor') return ['كم طلب عروض لديّ؟', 'ما أحدث العروض الواردة؟', 'ابحث عن موردين للكهرباء'];
    if (role === 'Supplier') return ['ما طلبات العروض المتاحة؟', 'كم عرضاً قدمت؟', 'ابحث عن طلبات في الرياض'];
    return ['إحصائيات المنصة', 'عدد المستخدمين', 'أكثر الفئات نشاطاً'];
  }
  if (role === 'Contractor') return ["How many RFQs do I have?", "Latest incoming offers?", "Find electrical suppliers"];
  if (role === 'Supplier') return ["Available RFQs for me?", "How many offers submitted?", "RFQs in Riyadh"];
  return ["Platform statistics", "Active users count", "Top categories"];
}

async function buildContext(
  firestore: ReturnType<typeof useFirestore>,
  userId: string,
  profile: Record<string, unknown>,
  role: string,
): Promise<RagContext> {
  const ctx: RagContext = { profile };

  try {
    if (role === 'Contractor') {
      const orgId = profile.organizationId as string | undefined;
      const rfqQ = orgId
        ? query(collection(firestore, 'rfqs'), where('organizationId', '==', orgId), limit(25))
        : query(collection(firestore, 'rfqs'), where('contractorId', '==', userId), limit(25));
      const rfqSnap = await getDocs(rfqQ);
      ctx.rfqs = rfqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (ctx.rfqs.length > 0) {
        const rfqIds = ctx.rfqs.slice(0, 10).map(r => r.id as string);
        const offersSnap = await getDocs(
          query(collection(firestore, 'offers'), where('rfqId', 'in', rfqIds), limit(30))
        );
        ctx.offers = offersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      // Only expose suppliers the contractor already has a relationship with
      const offerSupplierIds = [...new Set(
        (ctx.offers ?? []).map(o => o.supplierId as string).filter(Boolean)
      )];
      const favoriteIds = (profile.favoriteSuppliers as string[] | undefined) ?? [];
      const knownIds = [...new Set([...offerSupplierIds, ...favoriteIds])].slice(0, 30);
      if (knownIds.length > 0) {
        const suppSnap = await getDocs(
          query(collection(firestore, 'users'), where(documentId(), 'in', knownIds))
        );
        ctx.suppliers = suppSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

    } else if (role === 'Supplier') {
      const specs = (profile.specializations as string[] | undefined) ?? [];
      const rfqQ = specs.length > 0
        ? query(collection(firestore, 'rfqs'), where('status', '==', 'New'), where('category', 'in', specs.slice(0, 10)), limit(25))
        : query(collection(firestore, 'rfqs'), where('status', '==', 'New'), limit(20));
      const rfqSnap = await getDocs(rfqQ);
      ctx.rfqs = rfqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const offersSnap = await getDocs(
        query(collection(firestore, 'offers'), where('supplierId', '==', userId), limit(25))
      );
      ctx.offers = offersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    } else {
      const rfqSnap = await getDocs(query(collection(firestore, 'rfqs'), limit(20)));
      ctx.rfqs = rfqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const suppSnap = await getDocs(query(collection(firestore, 'users'), where('role', '==', 'Supplier'), limit(20)));
      ctx.suppliers = suppSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    console.warn('[RagChat] Context build warning:', err);
  }

  return ctx;
}

async function executeAction(
  action: PendingAction,
  firestore: ReturnType<typeof useFirestore>,
  userId: string,
): Promise<void> {
  const p = action.params;
  switch (action.type) {
    case 'submitOffer':
      await addDoc(collection(firestore, 'offers'), {
        rfqId: p.rfqId,
        supplierId: userId,
        price: Number(p.price) || 0,
        notes: p.notes ?? '',
        status: 'Pending',
        createdAt: serverTimestamp(),
      });
      break;
    case 'createInquiry':
      await addDoc(collection(firestore, `rfqs/${p.rfqId}/inquiries`), {
        question: p.question,
        userId,
        supplierId: userId,
        createdAt: serverTimestamp(),
      });
      break;
    case 'favoriteSupplier':
      await updateDoc(doc(firestore, 'users', userId), {
        favoriteSuppliers: arrayUnion(p.supplierId),
      });
      break;
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RagChatWidget({ userRole }: { userRole: 'Contractor' | 'Supplier' | 'Admin' }) {
  const t = useTranslations('RagChat');
  const locale = useLocale() as 'ar' | 'en';
  const isRTL = locale === 'ar';

  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [contextCache, setContextCache] = useState<RagContext | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, sendMessage, markActionExecuted, dismissAction, clear } = useRagChat();

  // Fetch user profile document
  const profileRef = useMemoFirebase(
    () => user ? doc(firestore, 'users', user.uid) : null,
    [user?.uid]
  );
  const { data: userProfile } = useDoc(profileRef);

  // Scroll to bottom
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  // Focus on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const getContext = useCallback(async (): Promise<RagContext> => {
    if (contextCache) return contextCache;
    if (!user) return {};
    const profile = userProfile ? { ...userProfile } as Record<string, unknown> : {};
    const ctx = await buildContext(firestore, user.uid, profile, userRole);
    setContextCache(ctx);
    return ctx;
  }, [contextCache, user, firestore, userProfile, userRole]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading || !user) return;
    const question = input.trim();
    setInput('');
    setActionError(null);
    const ctx = await getContext();
    await sendMessage(question, locale, userRole, ctx);
  }, [input, isLoading, user, getContext, sendMessage, locale, userRole]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleActionConfirm = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.pendingAction || !user) return;
    setActionError(null);
    try {
      await executeAction(msg.pendingAction, firestore, user.uid);
      markActionExecuted(messageId);
      setContextCache(null); // Invalidate after write
    } catch (err) {
      console.error('[RagChat] Action error:', err);
      setActionError(isRTL ? 'فشل تنفيذ الإجراء. يرجى المحاولة مرة أخرى.' : 'Action failed. Please try again.');
    }
  }, [messages, user, firestore, markActionExecuted, isRTL]);

  const handleOpen = () => {
    setIsOpen(true);
    if (user && !contextCache) getContext().catch(console.warn);
  };

  if (isUserLoading || !user) return null;

  return (
    <>
      {/* Floating button */}
      <motion.button
        className={cn(
          'fixed bottom-6 z-50 w-14 h-14 rounded-full shadow-xl',
          'bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
          isRTL ? 'left-6' : 'right-6'
        )}
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        aria-label={isOpen ? t('close') : t('open')}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isOpen ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X size={22} />
            </motion.span>
          ) : (
            <motion.span key="s" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <Sparkles size={22} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn(
              'fixed bottom-24 z-50 flex flex-col',
              'w-[360px] max-w-[calc(100vw-24px)]',
              'h-[520px] max-h-[calc(100dvh-160px)]',
              'rounded-2xl overflow-hidden shadow-2xl border border-border/40',
              'bg-background',
              isRTL ? 'left-6' : 'right-6'
            )}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <Bot size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">{t('title')}</p>
                  <p className="text-[10px] text-primary-foreground/55 mt-0.5">{t('subtitle')}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={clear}
                    className="h-7 w-7 p-0 text-primary-foreground/60 hover:text-primary-foreground hover:bg-white/10"
                    title={t('clear')}>
                    <Trash2 size={13} />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)}
                  className="h-7 w-7 p-0 text-primary-foreground/60 hover:text-primary-foreground hover:bg-white/10">
                  <X size={15} />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-2">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                    <Sparkles size={20} className="text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {welcomeText(userRole, isRTL)}
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {quickPrompts(userRole, isRTL).map(p => (
                      <button key={p}
                        className="text-xs px-3 py-1.5 rounded-full border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                        onClick={() => { setInput(p); inputRef.current?.focus(); }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      locale={locale}
                      onActionConfirm={handleActionConfirm}
                      onActionDismiss={dismissAction}
                    />
                  ))}
                  {actionError && (
                    <p className="text-xs text-destructive text-center mt-1">{actionError}</p>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border/40 p-3 flex-shrink-0 bg-background">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('placeholder')}
                  disabled={isLoading}
                  className={cn(
                    'flex-1 resize-none rounded-xl border border-input bg-muted/50 px-3 py-2',
                    'text-sm placeholder:text-muted-foreground leading-snug',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                    'disabled:opacity-50 min-h-[38px] max-h-[100px] overflow-y-auto'
                  )}
                />
                <Button
                  size="sm"
                  disabled={!input.trim() || isLoading}
                  onClick={handleSend}
                  className="h-9 w-9 p-0 flex-shrink-0 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl"
                >
                  <Send size={14} className={isRTL ? 'rotate-180' : ''} />
                </Button>
              </div>
              {isLoading && (
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">{t('thinking')}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
