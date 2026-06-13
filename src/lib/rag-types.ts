export type ChatRole = 'user' | 'assistant';

export type PendingActionType =
  | 'submitOffer'
  | 'createInquiry'
  | 'favoriteSupplier'
  | 'createRFQ';

export interface ActionParams {
  rfqId?: string;
  rfqTitle?: string;
  price?: number;
  notes?: string;
  question?: string;
  supplierId?: string;
  supplierName?: string;
  title?: string;
  category?: string;
  description?: string;
}

export interface PendingAction {
  type: PendingActionType;
  params: ActionParams;
  label: string;
  description: string;
}

export interface NavLink {
  label: string;
  path: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  pendingAction?: PendingAction;
  navLinks?: NavLink[];
  timestamp: Date;
  isLoading?: boolean;
  actionExecuted?: boolean;
}

export interface RagContext {
  profile?: Record<string, unknown>;
  rfqs?: Record<string, unknown>[];
  offers?: Record<string, unknown>[];
  suppliers?: Record<string, unknown>[];
}

export interface RagAskRequest {
  question: string;
  locale: 'ar' | 'en';
  userRole: 'Contractor' | 'Supplier' | 'Admin';
  context: RagContext;
}

export interface RagAskResponse {
  answer: string;
  pendingAction?: PendingAction;
  navLinks?: NavLink[];
}
