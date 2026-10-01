export type AccountType = 'bank' | 'cash';

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  institution: string;
  currency: string;
  openingBalance: number; // Integer minor units (e.g., paise)
  openingBalanceDate: string; // ISO date (YYYY-MM-DD)
  calculatedBalance: number; // Integer minor units
  reportedBalance?: number | null;
  lastReconciledAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceSnapshot {
  id: string;
  userId: string;
  accountId: string;
  snapshotDate: string;
  reportedBalance: number; // Integer minor units
  source: string;
  notes?: string;
  createdAt: string;
}

export interface CreateAccountPayload {
  name: string;
  type: AccountType;
  institution?: string;
  currency: string;
  openingBalance: number; // Integer minor units
  openingBalanceDate: string;
}

export interface UpdateAccountPayload {
  name?: string;
  institution?: string;
  currency?: string;
  openingBalance?: number;
  openingBalanceDate?: string;
  isActive?: boolean;
}

export interface ReconcilePayload {
  reportedBalance: number; // Integer minor units
  snapshotDate: string;
  source?: string;
  notes?: string;
  applyAdjustment?: boolean;
}

export interface ReconcileResult {
  account: Account;
  snapshot: BalanceSnapshot;
  calculatedBalance: number;
  reportedBalance: number;
  difference: number;
  adjustmentApplied: boolean;
  adjustmentTransaction?: unknown | null;
}

/**
 * Formats integer minor units (e.g. paise) to formatted currency display.
 */
export function formatMinorUnits(minorUnits: number | null | undefined, currency = 'INR'): string {
  if (minorUnits === null || minorUnits === undefined) {
    return '—';
  }
  const major = minorUnits / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

/**
 * Converts major units (e.g. ₹500.50) to integer minor units (50050 paise).
 */
export function toMinorUnits(majorUnits: number): number {
  return Math.round(majorUnits * 100);
}

/**
 * Converts integer minor units to floating major units for form display.
 */
export function toMajorUnits(minorUnits: number): number {
  return minorUnits / 100;
}
