'use server';

import { ai } from '@/ai/genkit';
import OpenAI from 'openai';
import { OpenRouterRateLimitError } from '@/ai/errors';

const PRIMARY_MODEL = 'googleai/gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── Circuit breaker ───────────────────────────────────────────────────────────
// NOTE: state is process-local. In serverless (Vercel) this resets on every
// cold start and is NOT shared across concurrent Lambda instances — the breaker
// only protects within a single warm process (i.e. local dev).
// To make it effective in production, replace with Vercel KV / Upstash Redis.
const circuitOpen: Record<string, number> = {};
const GEMINI_QUOTA_CIRCUIT_TTL_MS = 60 * 60 * 1000;    // 1 hour  — daily quota
const GEMINI_OVERLOAD_CIRCUIT_TTL_MS = 2 * 60 * 1000;  // 2 min   — transient 503
const GROQ_CIRCUIT_KEY = 'groq';
const OPENROUTER_CIRCUIT_KEY = 'openrouter';

function isCircuitOpen(key: string) {
  const until = circuitOpen[key];
  if (!until) return false;
  if (Date.now() > until) { delete circuitOpen[key]; return false; }
  return true;
}

function tripCircuit(key: string, ttlMs: number) {
  circuitOpen[key] = Date.now() + ttlMs;
  console.warn(`[AI] Circuit tripped for ${key} — bypassing for ${Math.round(ttlMs / 1000)}s`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type GenerateOptions = Parameters<typeof ai.generate>[0];

function isQuotaExhausted(err: any) {
  return err?.code === 429 || err?.status === 'RESOURCE_EXHAUSTED';
}

function isTransientOverload(err: any) {
  return err?.code === 503 || err?.status === 'UNAVAILABLE';
}

// ── Schema hint extraction ────────────────────────────────────────────────────

function schemaToFieldHint(schema: any): string {
  try {
    const shape = typeof schema?.shape === 'function' ? schema.shape() : schema?.shape;
    if (!shape) return '';
    const fields = Object.entries(shape).map(([key, val]: [string, any]) => {
      const isOptional = val?._def?.typeName === 'ZodOptional';
      const inner = isOptional ? val._def.innerType : val;
      const type = inner?._def?.typeName?.replace('Zod', '').toLowerCase() ?? 'any';
      return `  "${key}"${isOptional ? '?' : ''}: ${type}`;
    });
    return `{\n${fields.join(',\n')}\n}`;
  } catch {
    return '';
  }
}

// ── OpenAI-compatible call (shared by Groq + OpenRouter) ─────────────────────

async function callCompatible(
  options: GenerateOptions,
  apiKey: string,
  baseURL: string,
  model: string,
  circuitKey: string,
  label: string,
): Promise<{ output: any }> {
  const client = new OpenAI({ apiKey, baseURL });

  const systemText = typeof options.system === 'string' ? options.system : '';
  const promptText = typeof options.prompt === 'string' ? options.prompt : '';
  const zodSchema = (options as any).output?.schema;
  const hasSchema = !!zodSchema;

  const fieldHint = hasSchema ? schemaToFieldHint(zodSchema) : '';
  const schemaInstruction = fieldHint
    ? `\n\nIMPORTANT: Respond with ONLY a valid JSON object using these EXACT field names:\n${fieldHint}\nNo markdown fences, no extra fields, no explanation.`
    : '';

  const systemContent = hasSchema
    ? `${systemText}${schemaInstruction}`
    : systemText;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: promptText },
  ];

  const temperature = (options.config as any)?.temperature ?? 0.5;

  console.info(`[AI] Calling ${label}: ${model}`);

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      ...(hasSchema ? { response_format: { type: 'json_object' } } : {}),
    });

    const text = completion.choices[0]?.message?.content ?? '';

    if (!hasSchema) return { output: text };

    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    try {
      return { output: JSON.parse(cleaned) };
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return { output: JSON.parse(match[0]) };
      throw new Error(`${label} response was not valid JSON: ${cleaned.slice(0, 200)}`);
    }
  } catch (err: any) {
    if (err?.status === 429) {
      const retryAfter = parseInt(
      (typeof err?.headers?.get === 'function'
        ? err.headers.get('retry-after')
        : err?.headers?.['retry-after']) ?? '30',
      10,
    );
      tripCircuit(circuitKey, retryAfter * 1000);
      throw new OpenRouterRateLimitError(retryAfter);
    }
    throw err;
  }
}

function callGroq(options: GenerateOptions) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env.local');
  return callCompatible(options, apiKey, GROQ_BASE_URL, GROQ_MODEL, GROQ_CIRCUIT_KEY, 'Groq');
}

function callOpenRouter(options: GenerateOptions) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in .env.local');
  return callCompatible(options, apiKey, OPENROUTER_BASE_URL, OPENROUTER_MODEL, OPENROUTER_CIRCUIT_KEY, 'OpenRouter');
}

// ── Primary Gemini with retry ─────────────────────────────────────────────────

async function tryGemini(options: GenerateOptions) {
  try {
    return await ai.generate({ ...options, model: PRIMARY_MODEL });
  } catch (err: any) {
    if (isQuotaExhausted(err)) {
      tripCircuit(PRIMARY_MODEL, GEMINI_QUOTA_CIRCUIT_TTL_MS);
      return null;
    }
    if (isTransientOverload(err)) {
      await new Promise(r => setTimeout(r, 1500));
      try { return await ai.generate({ ...options, model: PRIMARY_MODEL }); } catch (retryErr: any) {
        if (isQuotaExhausted(retryErr)) {
          tripCircuit(PRIMARY_MODEL, GEMINI_QUOTA_CIRCUIT_TTL_MS);
          return null;
        }
        if (!isTransientOverload(retryErr)) throw retryErr;
      }
      tripCircuit(PRIMARY_MODEL, GEMINI_OVERLOAD_CIRCUIT_TTL_MS);
      return null;
    }
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Waterfall: Gemini 2.5 Flash → Groq Llama 3.3 70B → OpenRouter Llama 3.3 70B
 * Each leg has a circuit breaker that short-circuits on quota/rate-limit errors.
 * Required env vars: GOOGLE_GENAI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
 */
export async function aiGenerate(options: GenerateOptions) {
  // 1. Gemini (best quality)
  if (!isCircuitOpen(PRIMARY_MODEL)) {
    const result = await tryGemini(options);
    if (result) return result;
    console.warn('[AI] Gemini unavailable — trying Groq');
  } else {
    console.info('[AI] Gemini circuit open — skipping to Groq');
  }

  // 2. Groq (fast, generous free tier)
  if (!isCircuitOpen(GROQ_CIRCUIT_KEY)) {
    try {
      return await callGroq(options);
    } catch (err: any) {
      if (err instanceof OpenRouterRateLimitError) {
        console.warn(`[AI] Groq rate limited (${err.retryAfterSeconds}s) — trying OpenRouter`);
      } else {
        console.warn('[AI] Groq failed — trying OpenRouter', err?.message);
      }
    }
  } else {
    const secs = Math.ceil((circuitOpen[GROQ_CIRCUIT_KEY] - Date.now()) / 1000);
    console.info(`[AI] Groq circuit open (${secs}s) — skipping to OpenRouter`);
  }

  // 3. OpenRouter (last resort)
  if (isCircuitOpen(OPENROUTER_CIRCUIT_KEY)) {
    const until = circuitOpen[OPENROUTER_CIRCUIT_KEY];
    const waitSecs = until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 30;
    console.info(`[AI] OpenRouter circuit open — ${waitSecs}s remaining`);
    throw new OpenRouterRateLimitError(waitSecs);
  }

  return callOpenRouter(options);
}
