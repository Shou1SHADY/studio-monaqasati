import { NextRequest, NextResponse } from 'next/server';
import { landingChat, type LandingChatInput } from '@/ai/flows/landing-chat-flow';
import { OpenRouterRateLimitError } from '@/ai/errors';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<LandingChatInput>;

    const { question, locale, history } = body;

    if (!question?.trim()) {
      return NextResponse.json(
        { error: true, message: 'Question is required', code: 'MISSING_QUESTION' },
        { status: 400 }
      );
    }

    if (!locale || !['ar', 'en'].includes(locale)) {
      return NextResponse.json(
        { error: true, message: 'Invalid locale', code: 'INVALID_LOCALE' },
        { status: 400 }
      );
    }

    // Basic length guard
    if (question.trim().length > 500) {
      return NextResponse.json(
        { error: true, message: 'Question too long', code: 'TOO_LONG' },
        { status: 400 }
      );
    }

    const result = await landingChat({
      question: question.trim(),
      locale,
      history: history?.slice(-6) ?? [], // last 3 exchanges for context
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Landing Chat]', error);
    if (error instanceof OpenRouterRateLimitError) {
      return NextResponse.json(
        { error: true, message: 'AI service is temporarily unavailable', code: 'AI_RATE_LIMIT', retryAfter: error.retryAfterSeconds },
        { status: 503 }
      );
    }
    const isOverloaded =
      error?.code === 503 ||
      error?.status === 'UNAVAILABLE' ||
      error?.code === 429 ||
      error?.status === 'RESOURCE_EXHAUSTED';
    if (isOverloaded) {
      return NextResponse.json(
        { error: true, message: 'AI service is busy, please try again', code: 'AI_BUSY' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: true, message: 'Failed to process question', code: 'AI_ERROR' },
      { status: 500 }
    );
  }
}
