import { config } from 'dotenv';
config();

import '@/ai/flows/draft-rfq-description-flow.ts';
import '@/ai/flows/suggest-supplier-specializations-flow.ts';
import '@/ai/flows/recommend-suppliers-for-rfq-flow.ts';
import '@/ai/flows/recommend-rfq-for-supplier-flow.ts';
import '@/ai/flows/suggest-waste-percent-flow.ts';
import '@/ai/flows/suggest-boq-materials-flow.ts';