import { NextRequest, NextResponse } from 'next/server';
import { ragAsk, type RagAskInput } from '@/ai/flows/rag-ask-flow';
import { OpenRouterRateLimitError } from '@/ai/errors';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<RagAskInput>;

    const { question, locale, userRole, context } = body;

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

    if (!userRole || !['Contractor', 'Supplier', 'Admin'].includes(userRole)) {
      return NextResponse.json(
        { error: true, message: 'Invalid user role', code: 'INVALID_ROLE' },
        { status: 400 }
      );
    }

    const result = await ragAsk({
      question: question.trim(),
      locale,
      userRole,
      context: context ?? {},
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[RAG /ask]', error);
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
