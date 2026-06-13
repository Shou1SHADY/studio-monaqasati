'use client';

import { useState, useCallback } from 'react';
import type { ChatMessage, PendingAction, RagContext } from '@/lib/rag-types';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useRagChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (
    question: string,
    locale: 'ar' | 'en',
    userRole: 'Contractor' | 'Supplier' | 'Admin',
    context: RagContext,
  ) => {
    if (!question.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    const loadingMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), locale, userRole, context }),
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        throw new Error(json.message ?? 'Request failed');
      }

      const aiMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: json.data.answer,
        pendingAction: json.data.pendingAction ?? undefined,
        navLinks: json.data.navLinks ?? undefined,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev.slice(0, -1), aiMsg]);
    } catch {
      const errMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: locale === 'ar'
          ? 'حدث خطأ أثناء معالجة سؤالك. يرجى المحاولة مرة أخرى.'
          : 'An error occurred while processing your question. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(0, -1), errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const markActionExecuted = useCallback((messageId: string) => {
    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, actionExecuted: true } : m)
    );
  }, []);

  const dismissAction = useCallback((messageId: string) => {
    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, pendingAction: undefined } : m)
    );
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, isLoading, sendMessage, markActionExecuted, dismissAction, clear };
}
