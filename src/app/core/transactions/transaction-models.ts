export type TransactionType =
  | 'INCOME'
  | 'EXPENSE'
  | 'INTERNAL_TRANSFER'
  | 'INVESTMENT_ALLOCATION'
  | 'TAX'
  | 'MONEY_LENT'
  | 'RECEIVABLE_REPAYMENT'
  | 'DEBT_BORROWING'
  | 'DEBT_REPAYMENT'
  | 'NON_FINANCIAL_ASSET_PURCHASE';

export type TransactionStatus = 'POSTED' | 'VOIDED';

export type TransferDirection = 'OUT' | 'IN';

export interface SplitAllocation {
  id: string;
  transactionId: string;
  categoryId: string;
  amount: number; // Integer minor units (e.g. paise)
  tags: string[];
  notes: string;
}

export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  transactionDate: string; // YYYY-MM-DD
  amount: number; // Integer minor units
  type: TransactionType;
  categoryId: string | null;
  counterpartyId: string | null;
  description: string;
  tags: string[];
  notes: string;
  status: TransactionStatus;
  transferGroupId: string | null;
  transferDirection?: TransferDirection | null;
  destinationAccountId?: string | null;
  recurringTemplateId?: string | null;
  allocations: SplitAllocation[];
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface Category {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Counterparty {
  id: string;
  userId: string;
  name: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionPayload {
  accountId: string;
  transactionDate: string;
  amount: number; // Integer minor units
  type: TransactionType;
  categoryId?: string | null;
  counterpartyId?: string | null;
  description: string;
  tags?: string[];
  notes?: string;
  allocations?: {
    categoryId: string;
    amount: number;
    tags?: string[];
    notes?: string;
  }[];
  idempotencyKey?: string | null;
}

export interface CreateTransferPayload {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  transactionDate: string;
  description?: string;
  notes?: string;
  tags?: string[];
  idempotencyKey?: string | null;
}

export interface UpdateTransactionPayload {
  transactionDate?: string;
  amount?: number;
  type?: TransactionType;
  categoryId?: string | null;
  counterpartyId?: string | null;
  description?: string;
  tags?: string[];
  notes?: string;
  allocations?: {
    categoryId: string;
    amount: number;
    tags?: string[];
    notes?: string;
  }[];
}

export interface PaginatedTransactionsResult {
  items: Transaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TransactionFilterQuery {
  accountId?: string;
  type?: TransactionType;
  categoryId?: string;
  counterpartyId?: string;
  tag?: string;
  status?: TransactionStatus | 'ALL';
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, { label: string; icon: string; cashImpact: string }> = {
  INCOME: { label: 'Income', icon: 'arrow_downward', cashImpact: '+ Cash' },
  EXPENSE: { label: 'Expense', icon: 'arrow_upward', cashImpact: '- Cash' },
  INTERNAL_TRANSFER: { label: 'Internal Transfer', icon: 'sync_alt', cashImpact: 'Neutral' },
  INVESTMENT_ALLOCATION: { label: 'Investment Allocation', icon: 'trending_up', cashImpact: '- Cash' },
  TAX: { label: 'Tax Payment', icon: 'account_balance', cashImpact: '- Cash' },
  MONEY_LENT: { label: 'Money Lent', icon: 'handshake', cashImpact: '- Cash' },
  RECEIVABLE_REPAYMENT: { label: 'Receivable Repayment', icon: 'savings', cashImpact: '+ Cash' },
  DEBT_BORROWING: { label: 'Debt Borrowing', icon: 'credit_card', cashImpact: '+ Cash' },
  DEBT_REPAYMENT: { label: 'Debt Repayment', icon: 'price_check', cashImpact: '- Cash' },
  NON_FINANCIAL_ASSET_PURCHASE: { label: 'Asset Acquisition', icon: 'domain', cashImpact: '- Cash' },
};
