import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  // A rolling alias, not a pinned version — Google retires dated model ids
  // (gemini-2.5-flash-lite 404s for new API keys as of Aug 2026); "-latest"
  // always resolves to the current recommended lite model instead of going
  // stale the same way again.
  model: 'googleai/gemini-flash-lite-latest',
});
