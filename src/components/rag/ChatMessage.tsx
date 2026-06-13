'use client';

import { Bot, User, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/lib/rag-types';
import { Link } from '@/i18n/routing';
import { ActionCard } from './ActionCard';

interface ChatMessageProps {
  message: ChatMessageType;
  locale: 'ar' | 'en';
  onActionConfirm: (messageId: string) => void;
  onActionDismiss: (messageId: string) => void;
}

export function ChatMessage({ message, locale, onActionConfirm, onActionDismiss }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex items-start gap-2 mb-4', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent/15 text-accent'
      )}>
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>

      {/* Bubble + action */}
      <div className={cn('flex flex-col max-w-[82%]', isUser ? 'items-end' : 'items-start')}>
        <div className={cn(
          'px-3 py-2 rounded-2xl text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-none'
            : 'bg-muted text-foreground rounded-tl-none'
        )}>
          {message.isLoading ? (
            <div className="flex items-center gap-1 py-0.5">
              {[0, 150, 300].map(delay => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>

        {message.navLinks && message.navLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {message.navLinks.map(link => (
              <Link key={link.path} href={link.path as never}>
                <span className={cn(
                  'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium',
                  'bg-accent/10 text-accent border border-accent/20',
                  'hover:bg-accent/20 transition-colors cursor-pointer'
                )}>
                  <ExternalLink size={11} />
                  {link.label}
                </span>
              </Link>
            ))}
          </div>
        )}

        {message.pendingAction && (
          <ActionCard
            action={message.pendingAction}
            executed={message.actionExecuted}
            locale={locale}
            onConfirm={() => onActionConfirm(message.id)}
            onDismiss={() => onActionDismiss(message.id)}
          />
        )}
      </div>
    </div>
  );
}
