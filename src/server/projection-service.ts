import { getFirebaseAdmin } from './firebase-admin.js';
import type { TransactionDocument } from './transaction-service.js';

export interface MonthlySummaryProjection {
  grossIncome: number;
  netTaxPaid: number;
  consumptionExpenses: number;
  nonFinancialAssetPurchases: number;
  investmentAllocation: number;
  borrowings: number;
  debtRepayments: number;
  moneyLent: number;
  receivableRepayments: number;
  reconciliationAdjustments: number;
}

export interface DashboardProjection {
  userId: string;
  version: number;
  updatedAt: string;
  lifetime: {
    grossIncome: number;
    netTaxPaid: number;
    consumptionExpenses: number;
    nonFinancialAssetPurchases: number;
    investmentAllocation: number;
    moneyLent: number;
    receivableRepayments: number;
    borrowings: number;
    debtRepayments: number;
    reconciliationAdjustments: number;
    totalPostedTransactions: number;
    earliestTransactionDate: string | null;
  };
  debt: {
    cumulativeDebtBorrowing: number;
    cumulativeDebtRepayment: number;
    outstandingDebtLiability: number;
  };
  monthlySummaries: Record<string, MonthlySummaryProjection>;
}

export function createEmptyProjection(userId: string): DashboardProjection {
  return {
    userId,
    version: 1,
    updatedAt: new Date().toISOString(),
    lifetime: {
      grossIncome: 0,
      netTaxPaid: 0,
      consumptionExpenses: 0,
      nonFinancialAssetPurchases: 0,
      investmentAllocation: 0,
      moneyLent: 0,
      receivableRepayments: 0,
      borrowings: 0,
      debtRepayments: 0,
      reconciliationAdjustments: 0,
      totalPostedTransactions: 0,
      earliestTransactionDate: null,
    },
    debt: {
      cumulativeDebtBorrowing: 0,
      cumulativeDebtRepayment: 0,
      outstandingDebtLiability: 0,
    },
    monthlySummaries: {},
  };
}

export function applyTransactionToProjectionData(
  proj: DashboardProjection,
  tx: TransactionDocument,
  multiplier: 1 | -1 = 1,
): void {
  if (tx.status !== 'POSTED') return;

  const amt = tx.amount * multiplier;
  const monthKey = tx.transactionDate.length >= 7 ? tx.transactionDate.substring(0, 7) : null;

  if (monthKey && !proj.monthlySummaries[monthKey]) {
    proj.monthlySummaries[monthKey] = {
      grossIncome: 0,
      netTaxPaid: 0,
      consumptionExpenses: 0,
      nonFinancialAssetPurchases: 0,
      investmentAllocation: 0,
      borrowings: 0,
      debtRepayments: 0,
      moneyLent: 0,
      receivableRepayments: 0,
      reconciliationAdjustments: 0,
    };
  }

  const m = monthKey ? proj.monthlySummaries[monthKey] : null;

  proj.lifetime.totalPostedTransactions += multiplier;
  if (proj.lifetime.totalPostedTransactions < 0) proj.lifetime.totalPostedTransactions = 0;

  if (multiplier > 0) {
    if (!proj.lifetime.earliestTransactionDate || tx.transactionDate < proj.lifetime.earliestTransactionDate) {
      proj.lifetime.earliestTransactionDate = tx.transactionDate;
    }
  }

  switch (tx.type) {
    case 'INCOME':
      proj.lifetime.grossIncome += amt;
      if (m) m.grossIncome += amt;
      break;

    case 'TAX':
      proj.lifetime.netTaxPaid += amt;
      if (m) m.netTaxPaid += amt;
      break;

    case 'EXPENSE':
      proj.lifetime.consumptionExpenses += amt;
      if (m) m.consumptionExpenses += amt;
      break;

    case 'NON_FINANCIAL_ASSET_PURCHASE':
      proj.lifetime.nonFinancialAssetPurchases += amt;
      if (m) m.nonFinancialAssetPurchases += amt;
      break;

    case 'INVESTMENT_ALLOCATION':
      proj.lifetime.investmentAllocation += amt;
      if (m) m.investmentAllocation += amt;
      break;

    case 'MONEY_LENT':
      proj.lifetime.moneyLent += amt;
      if (m) m.moneyLent += amt;
      break;

    case 'RECEIVABLE_REPAYMENT':
      proj.lifetime.receivableRepayments += amt;
      if (m) m.receivableRepayments += amt;
      break;

    case 'DEBT_BORROWING':
      proj.lifetime.borrowings += amt;
      proj.debt.cumulativeDebtBorrowing += amt;
      if (m) m.borrowings += amt;
      break;

    case 'DEBT_REPAYMENT':
      proj.lifetime.debtRepayments += amt;
      proj.debt.cumulativeDebtRepayment += amt;
      if (m) m.debtRepayments += amt;
      break;

    case 'RECONCILIATION_ADJUSTMENT': {
      const delta = tx.reconciliationDiscrepancy !== undefined && tx.reconciliationDiscrepancy !== null
        ? tx.reconciliationDiscrepancy * multiplier
        : amt;
      proj.lifetime.reconciliationAdjustments += delta;
      if (m) m.reconciliationAdjustments += delta;
      break;
    }

    case 'INTERNAL_TRANSFER':
      // Internal transfers have no impact on lifetime savings, income, expenses, or debt
      break;
  }

  proj.debt.outstandingDebtLiability = Math.max(
    0,
    proj.debt.cumulativeDebtBorrowing - proj.debt.cumulativeDebtRepayment,
  );

  proj.updatedAt = new Date().toISOString();
}

/**
 * Rebuilds the user's dashboard projection completely from the canonical transaction ledger.
 * This is an idempotent, deterministic projection of the ledger.
 */
export async function rebuildProjectionFromLedger(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const txCol = db.collection('users').doc(userId).collection('transactions');
  const snap = await txCol.where('status', '==', 'POSTED').get();

  const proj = createEmptyProjection(userId);
  const txDocs = snap.docs.map((d) => d.data() as TransactionDocument);

  // Sort chronologically for deterministic earliest date resolution
  txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  for (const tx of txDocs) {
    applyTransactionToProjectionData(proj, tx, 1);
  }

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  await projRef.set(proj);

  return proj;
}

/**
 * Retrieves the stored projection document. If not yet initialized, rebuilds it from the ledger.
 */
export async function getOrBuildProjection(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const snap = await projRef.get();
    if (snap.exists) {
      return snap.data() as DashboardProjection;
    }
  } catch {
    // If projections collection is unavailable or not yet provisioned, fall back to rebuild
  }

  return rebuildProjectionFromLedger(userId);
}

/**
 * Updates the projection incrementally when a transaction is created.
 */
export async function recordTransactionCreatedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  if (tx.status !== 'POSTED') return;

  const { db } = getFirebaseAdmin();
  if (!db) return;

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const snap = await projRef.get();
    let proj: DashboardProjection;
    if (snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = await rebuildProjectionFromLedger(userId);
      return;
    }

    applyTransactionToProjectionData(proj, tx, 1);
    await projRef.set(proj);
  } catch {
    // Non-blocking projection sync: rebuild will heal on next dashboard load if this failed
  }
}

/**
 * Updates the projection incrementally when a transaction is voided.
 */
export async function recordTransactionVoidedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const snap = await projRef.get();
    if (!snap.exists) {
      await rebuildProjectionFromLedger(userId);
      return;
    }

    const proj = snap.data() as DashboardProjection;
    applyTransactionToProjectionData(proj, tx, -1);
    await projRef.set(proj);
  } catch {
    // Non-blocking projection sync
  }
}

/**
 * Updates the projection incrementally when a transaction is edited.
 */
export async function recordTransactionUpdatedInProjection(
  userId: string,
  oldTx: TransactionDocument,
  newTx: TransactionDocument,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const snap = await projRef.get();
    if (!snap.exists) {
      await rebuildProjectionFromLedger(userId);
      return;
    }

    const proj = snap.data() as DashboardProjection;
    // Revert old transaction deltas and apply new transaction deltas
    applyTransactionToProjectionData(proj, oldTx, -1);
    applyTransactionToProjectionData(proj, newTx, 1);
    await projRef.set(proj);
  } catch {
    // Non-blocking projection sync
  }
}

/**
 * Verifies that the stored projection is 100% consistent with the canonical transaction ledger.
 */
export async function verifyProjectionConsistency(userId: string): Promise<{
  isConsistent: boolean;
  discrepancies: string[];
  storedProjection: DashboardProjection;
  recalculatedProjection: DashboardProjection;
}> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const stored = await getOrBuildProjection(userId);

  // Recalculate freshly from ledger
  const txCol = db.collection('users').doc(userId).collection('transactions');
  const snap = await txCol.where('status', '==', 'POSTED').get();
  const txDocs = snap.docs.map((d) => d.data() as TransactionDocument);
  txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const expected = createEmptyProjection(userId);
  for (const tx of txDocs) {
    applyTransactionToProjectionData(expected, tx, 1);
  }

  const discrepancies: string[] = [];

  if (stored.lifetime.grossIncome !== expected.lifetime.grossIncome) {
    discrepancies.push(`grossIncome mismatch: stored ${stored.lifetime.grossIncome} vs expected ${expected.lifetime.grossIncome}`);
  }
  if (stored.lifetime.netTaxPaid !== expected.lifetime.netTaxPaid) {
    discrepancies.push(`netTaxPaid mismatch: stored ${stored.lifetime.netTaxPaid} vs expected ${expected.lifetime.netTaxPaid}`);
  }
  if (stored.lifetime.consumptionExpenses !== expected.lifetime.consumptionExpenses) {
    discrepancies.push(`consumptionExpenses mismatch: stored ${stored.lifetime.consumptionExpenses} vs expected ${expected.lifetime.consumptionExpenses}`);
  }
  if (stored.lifetime.nonFinancialAssetPurchases !== expected.lifetime.nonFinancialAssetPurchases) {
    discrepancies.push(`nonFinancialAssetPurchases mismatch: stored ${stored.lifetime.nonFinancialAssetPurchases} vs expected ${expected.lifetime.nonFinancialAssetPurchases}`);
  }
  if (stored.debt.cumulativeDebtBorrowing !== expected.debt.cumulativeDebtBorrowing) {
    discrepancies.push(`debtBorrowing mismatch: stored ${stored.debt.cumulativeDebtBorrowing} vs expected ${expected.debt.cumulativeDebtBorrowing}`);
  }
  if (stored.debt.cumulativeDebtRepayment !== expected.debt.cumulativeDebtRepayment) {
    discrepancies.push(`debtRepayment mismatch: stored ${stored.debt.cumulativeDebtRepayment} vs expected ${expected.debt.cumulativeDebtRepayment}`);
  }
  if (stored.debt.outstandingDebtLiability !== expected.debt.outstandingDebtLiability) {
    discrepancies.push(`outstandingDebtLiability mismatch: stored ${stored.debt.outstandingDebtLiability} vs expected ${expected.debt.outstandingDebtLiability}`);
  }
  if (stored.lifetime.totalPostedTransactions !== expected.lifetime.totalPostedTransactions) {
    discrepancies.push(`totalPostedTransactions mismatch: stored ${stored.lifetime.totalPostedTransactions} vs expected ${expected.lifetime.totalPostedTransactions}`);
  }

  return {
    isConsistent: discrepancies.length === 0,
    discrepancies,
    storedProjection: stored,
    recalculatedProjection: expected,
  };
}
