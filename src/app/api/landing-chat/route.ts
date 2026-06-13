import { NextRequest, NextResponse } from 'next/server';
import { landingChat, type LandingChatInput } from '@/ai/flows/landing-chat-flow';

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
  } catch (error) {
    console.error('[Landing Chat]', error);
    return NextResponse.json(
      { error: true, message: 'Failed to process question', code: 'AI_ERROR' },
      { status: 500 }
    );
  }
}
