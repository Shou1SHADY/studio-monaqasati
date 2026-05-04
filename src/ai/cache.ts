/**
 * Simple in-memory cache for AI responses
 * In production, replace with Firestore/Redis cache
 */

type CacheEntry = {
  response: any;
  expires: number;
};

const aiCache = new Map<string, CacheEntry>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedAIResponse(promptHash: string): any | null {
  const entry = aiCache.get(promptHash);
  if (!entry) return null;
  
  if (Date.now() > entry.expires) {
    aiCache.delete(promptHash);
    return null;
  }
  
  return entry.response;
}

export function setCachedAIResponse(promptHash: string, response: any): void {
  aiCache.set(promptHash, {
    response,
    expires: Date.now() + CACHE_TTL,
  });
}

export function generatePromptHash(input: object): string {
  // Use JSON string with encodeURIComponent to handle non-ASCII (Arabic)
  const str = encodeURIComponent(JSON.stringify(input));
  let hash = '';
  for (let i = 0; i < 32; i++) {
    const char = str.charCodeAt(i % str.length);
    hash += ((char * 31 + i) % 36).toString(36);
  }
  return hash;
}

// Cleanup expired entries every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of aiCache.entries()) {
      if (now > entry.expires) {
        aiCache.delete(key);
      }
    }
  }, 60 * 60 * 1000);
}
