'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Send, Sparkles, ArrowRight, User, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useLandingChat, type LandingMessage } from '@/hooks/useLandingChat';

// ── Quick prompts by locale ───────────────────────────────────────────────────

const QUICK_PROMPTS = {
  ar: [
    'ما هي مدماك تيك؟',
    'كيف أستفيد كمقاول؟',
    'كيف أستفيد كمورد؟',
    'هل التسجيل مجاني؟',
    'ما الفئات المتاحة؟',
  ],
  en: [
    'What is Mdmak Tech?',
    'How does it work for contractors?',
    'How does it work for suppliers?',
    'Is registration free?',
    'What materials are covered?',
  ],
};

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isRTL,
  locale,
  onFollowUp,
}: {
  msg: LandingMessage;
  isRTL: boolean;
  locale: 'ar' | 'en';
  onFollowUp: (q: string) => void;
}) {
  const isUser = msg.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('flex items-end gap-2 mb-4', isUser && 'flex-row-reverse')}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center shadow-sm">
          <Sparkles size={14} className="text-white" />
        </div>
      )}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
          <User size={13} className="text-white/80" />
        </div>
      )}

      <div className={cn('flex flex-col max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        {/* Bubble */}
        <div className={cn(
          'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
          isUser
            ? 'bg-white/15 text-white border border-white/10 rounded-br-none'
            : 'bg-white text-primary rounded-bl-none shadow-sm'
        )}>
          {msg.isLoading ? (
            <div className="flex items-center gap-1 py-1">
              {[0, 150, 300].map(d => (
                <span key={d} className={cn('w-2 h-2 rounded-full animate-bounce',
                  isUser ? 'bg-white/60' : 'bg-primary/40'
                )} style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          )}
        </div>

        {/* CTA Button */}
        {msg.ctaLabel && msg.ctaPath && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-2"
          >
            <Link href={msg.ctaPath as any}>
              <Button size="sm"
                className="h-8 text-xs bg-accent hover:bg-accent/90 text-white gap-1.5 rounded-full px-4 shadow-md">
                {msg.ctaLabel}
                <ArrowRight size={12} className={isRTL ? 'rotate-180' : ''} />
              </Button>
            </Link>
          </motion.div>
        )}

        {/* Follow-up chips */}
        {msg.followUps && msg.followUps.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5 mt-2', isUser ? 'justify-end' : 'justify-start')}>
            {msg.followUps.map(q => (
              <button key={q}
                className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 transition-colors"
                onClick={() => onFollowUp(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function LandingChatWidget() {
  const locale = useLocale() as 'ar' | 'en';
  const isRTL = locale === 'ar';

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [showTeaser, setShowTeaser] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, sendMessage, clear } = useLandingChat();

  // Show teaser bubble after 4s on first load
  useEffect(() => {
    const t = setTimeout(() => setShowTeaser(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 350);
  }, [isOpen]);

  const handleSend = useCallback(async (question?: string) => {
    const q = question ?? input;
    if (!q.trim() || isLoading) return;
    setInput('');
    setShowTeaser(false);
    await sendMessage(q, locale);
  }, [input, isLoading, sendMessage, locale]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    setShowTeaser(false);
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Teaser bubble */}
      <AnimatePresence>
        {showTeaser && !isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            onClick={handleOpen}
            className={cn(
              'fixed bottom-24 z-50 max-w-[220px]',
              'bg-primary text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl',
              'border border-white/10 leading-relaxed text-start',
              isRTL ? 'left-6 rounded-bl-none' : 'right-6 rounded-br-none'
            )}
          >
            {isRTL
              ? '👋 مرحباً! هل لديك أسئلة حول المنصة؟'
              : '👋 Hello! Any questions about the platform?'}
            <div className={cn(
              'absolute bottom-[-6px] w-3 h-3 bg-primary rotate-45',
              isRTL ? 'left-4' : 'right-4'
            )} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <motion.button
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'fixed bottom-6 z-50 w-14 h-14 rounded-full shadow-2xl',
          'flex items-center justify-center',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
          isRTL ? 'left-6' : 'right-6'
        )}
        aria-label={isOpen ? (isRTL ? 'إغلاق' : 'Close') : (isRTL ? 'مساعد مدماك' : 'Mdmak Assistant')}
      >
        {/* Animated gradient background */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent via-cta to-primary animate-[spin_4s_linear_infinite] opacity-90" />
        <div className="absolute inset-0.5 rounded-full bg-gradient-to-br from-accent to-primary" />
        {/* Pulse ring */}
        {!isOpen && (
          <div className="absolute inset-0 rounded-full bg-accent/30 animate-ping" />
        )}
        <div className="relative z-10 text-white">
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
        </div>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            dir={isRTL ? 'rtl' : 'ltr'}
            className={cn(
              'fixed bottom-24 z-50 flex flex-col',
              'w-[380px] max-w-[calc(100vw-24px)]',
              'h-[560px] max-h-[calc(100dvh-160px)]',
              'rounded-3xl overflow-hidden shadow-2xl',
              // Gradient background — distinct from portal widget
              'bg-gradient-to-b from-primary via-primary to-[#0c1f3d]',
              isRTL ? 'left-6' : 'right-6'
            )}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 flex-shrink-0 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent to-cta flex items-center justify-center shadow-lg">
                    <Sparkles size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-none">
                      {isRTL ? 'مساعد مدماك' : 'Mdmak Assistant'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <p className="text-[10px] text-white/50">
                        {isRTL ? 'مدعوم بالذكاء الاصطناعي' : 'Powered by AI · Always online'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {hasMessages && (
                    <button onClick={clear}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
                      title={isRTL ? 'مسح' : 'Clear'}>
                      <RotateCcw size={13} />
                    </button>
                  )}
                  <button onClick={() => setIsOpen(false)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors">
                    <X size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 scroll-smooth">
              {!hasMessages ? (
                /* Welcome state */
                <div className="flex flex-col h-full">
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-accent/20 to-white/5 border border-white/10 flex items-center justify-center mb-4">
                      <Sparkles size={28} className="text-accent" />
                    </div>
                    <h3 className="text-white font-semibold text-base mb-2">
                      {isRTL ? 'كيف يمكنني مساعدتك؟' : 'How can I help you?'}
                    </h3>
                    <p className="text-white/50 text-xs leading-relaxed mb-6">
                      {isRTL
                        ? 'اسألني عن المنصة، المزايا، كيفية التسجيل، أو أي شيء آخر!'
                        : 'Ask me about the platform, features, how to register, or anything else!'}
                    </p>
                  </div>

                  {/* Quick prompt chips */}
                  <div className="flex flex-col gap-2">
                    {QUICK_PROMPTS[locale].map(q => (
                      <button key={q}
                        onClick={() => handleSend(q)}
                        className={cn(
                          'w-full text-start px-4 py-2.5 rounded-xl text-sm',
                          'bg-white/8 border border-white/10 text-white/80',
                          'hover:bg-white/15 hover:text-white transition-colors',
                          'flex items-center justify-between gap-2'
                        )}>
                        <span>{q}</span>
                        <ArrowRight size={13} className={cn('flex-shrink-0 text-accent', isRTL && 'rotate-180')} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isRTL={isRTL}
                      locale={locale}
                      onFollowUp={q => handleSend(q)}
                    />
                  ))}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 pb-4 pt-3 flex-shrink-0 border-t border-white/10">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  placeholder={isRTL ? 'اكتب سؤالك هنا...' : 'Type your question here...'}
                  className={cn(
                    'flex-1 resize-none rounded-2xl px-4 py-2.5',
                    'bg-white/10 border border-white/15 text-white placeholder:text-white/35',
                    'text-sm leading-snug min-h-[42px] max-h-[100px] overflow-y-auto',
                    'focus-visible:outline-none focus-visible:border-accent/60 focus-visible:bg-white/15',
                    'disabled:opacity-50 transition-colors'
                  )}
                />
                <button
                  disabled={!input.trim() || isLoading}
                  onClick={() => handleSend()}
                  className={cn(
                    'flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center',
                    'bg-accent hover:bg-accent/90 text-white transition-colors shadow-lg',
                    'disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  <Send size={15} className={isRTL ? 'rotate-180' : ''} />
                </button>
              </div>
              {isLoading && (
                <p className="text-[10px] text-white/35 text-center mt-2">
                  {isRTL ? 'جارٍ التفكير...' : 'Thinking...'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
