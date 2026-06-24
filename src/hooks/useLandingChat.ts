'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';

export interface LandingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ctaLabel?: string;
  ctaPath?: string;
  followUps?: string[];
  isLoading?: boolean;
  timestamp: Date;
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useLandingChat() {
  const t = useTranslations('RagChat');
  const [messages, setMessages] = useState<LandingMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (
    question: string,
    locale: 'ar' | 'en',
  ) => {
    if (!question.trim() || isLoading) return;

    const userMsg: LandingMessage = {
      id: genId(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    const loadingMsg: LandingMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setIsLoading(true);

    // Build history for context (last 3 exchanges = 6 messages)
    const history = [...messages, userMsg]
      .filter(m => !m.isLoading)
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }));

    let resStatus = 0;
    let lastJson: any = null;
    try {
      const res = await fetch('/api/landing-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), locale, history }),
      });

      resStatus = res.status;
      const json = await res.json();
      lastJson = json;

      if (!res.ok || json.error) throw new Error(json.message ?? 'Request failed');

      const aiMsg: LandingMessage = {
        id: genId(),
        role: 'assistant',
        content: json.data.answer,
        ctaLabel: json.data.ctaLabel,
        ctaPath: json.data.ctaPath,
        followUps: json.data.followUps,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev.slice(0, -1), aiMsg]);
    } catch (err: any) {
      const isBusy = resStatus === 503;
      let errorContent = '';
      if (lastJson?.code === 'AI_RATE_LIMIT' && lastJson?.retryAfter) {
        errorContent = t('errorBusyRetry', { secs: lastJson.retryAfter as number });
      } else if (isBusy) {
        errorContent = t('errorBusy');
      } else {
        errorContent = t('error');
      }
      const errMsg: LandingMessage = {
        id: genId(),
        role: 'assistant',
        content: errorContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(0, -1), errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages]);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, isLoading, sendMessage, clear };
}
