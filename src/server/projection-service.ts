import { getFirebaseAdmin } from './firebase-admin.js';
import type { TransactionDocument } from './transaction-service.js';
import type { TransactionType } from './reporting-semantics.js';
import type {
  Transaction as FirestoreTransaction,
  CollectionReference as FirestoreCollectionReference,
} from 'firebase-admin/firestore';

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

export interface AppliedTxMeta {
  status: 'POSTED' | 'VOIDED' | 'DRAFT';
  updatedAt: string;
  type: string;
  amount: number;
  transactionDate: string;
  reconciliationDiscrepancy?: number | null;
}

export interface DashboardProjection {
  userId: string;
  version: number;
  updatedAt: string;
  rebuiltAt?: string;
  isStale?: boolean;
  staleReason?: string | null;
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
  appliedTxMeta: Record<string, AppliedTxMeta>;
}

export interface ConsistencyVerificationResult {
  isConsistent: boolean;
  discrepancies: string[];
  storedProjection: DashboardProjection;
  recalculatedProjection: DashboardProjection;
}

export function createEmptyProjection(userId: string): DashboardProjection {
  return {
    userId,
    version: 1,
    updatedAt: new Date().toISOString(),
    isStale: false,
    staleReason: null,
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
    appliedTxMeta: {},
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
      // Internal transfers have no impact on income, expense, savings, or debt liabilities
      break;
  }

  proj.debt.outstandingDebtLiability = Math.max(
    0,
    proj.debt.cumulativeDebtBorrowing - proj.debt.cumulativeDebtRepayment,
  );

  proj.updatedAt = new Date().toISOString();
}

/**
 * Safely runs a transaction across Firebase Firestore or mock database setups.
 */
async function executeTransaction<T>(
  db: FirebaseFirestore.Firestore,
  updateFunction: (transaction: FirestoreTransaction) => Promise<T>,
): Promise<T> {
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(updateFunction);
  }
  const simulated = {
    get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
    set: (ref: { set: (d: unknown, o?: unknown) => Promise<unknown> | void }, data: unknown, options?: unknown) => ref.set(data, options),
    update: (ref: { update: (d: unknown) => Promise<unknown> | void }, data: unknown) => ref.update(data),
  };
  return updateFunction(simulated as unknown as FirestoreTransaction);
}

/**
 * Resolves the earliest POSTED transaction date from the canonical ledger using an indexed query.
 */
export async function resolveEarliestTransactionDate(
  userId: string,
  txCol?: FirestoreCollectionReference,
): Promise<string | null> {
  const { db } = getFirebaseAdmin();
  if (!db) return null;
  const col = txCol || db.collection('users').doc(userId).collection('transactions');

  try {
    const snap = await col
      .where('status', '==', 'POSTED')
      .orderBy('transactionDate', 'asc')
      .limit(1)
      .get();
    if (snap && !snap.empty && snap.docs && snap.docs.length > 0) {
      const first = snap.docs[0].data() as TransactionDocument;
      return first.transactionDate || null;
    }
    return null;
  } catch {
    // In mock testing environments where orderBy or limit might not be fully simulated:
    try {
      const allSnap = await col.where('status', '==', 'POSTED').get();
      if (!allSnap || allSnap.empty || !allSnap.docs.length) return null;
      const dates = allSnap.docs
        .map((d) => (d.data() as TransactionDocument).transactionDate)
        .filter(Boolean)
        .sort();
      return dates[0] || null;
    } catch {
      return null;
    }
  }
}

/**
 * Marks the dashboard projection stale so subsequent reads will trigger automatic repair rebuild.
 */
export async function markProjectionStale(userId: string, reason: string): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const now = new Date().toISOString();
    await projRef.set(
      {
        isStale: true,
        staleReason: reason,
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (err) {
    console.error(`Failed to mark projection stale for user ${userId}:`, err);
  }
}

/**
 * Updates the projection atomically when a transaction is created.
 * Idempotent: Repeated calls with identical transaction state are safe no-ops.
 */
export async function recordTransactionCreatedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  if (tx.status !== 'POSTED') return;

  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');

  await executeTransaction(db, async (t) => {
    const snap = await t.get(projRef);
    let proj: DashboardProjection;
    if (snap && snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = createEmptyProjection(userId);
    }

    if (!proj.appliedTxMeta) {
      proj.appliedTxMeta = {};
    }

    const existingMeta = proj.appliedTxMeta[tx.id];
    if (existingMeta && existingMeta.updatedAt === tx.updatedAt && existingMeta.status === tx.status) {
      // Already applied identically; safe to retry
      return;
    }

    if (existingMeta && existingMeta.status === 'POSTED') {
      applyTransactionToProjectionData(
        proj,
        {
          id: tx.id,
          userId: tx.userId,
          accountId: tx.accountId,
          type: existingMeta.type as TransactionType,
          amount: existingMeta.amount,
          transactionDate: existingMeta.transactionDate,
          status: 'POSTED',
          reconciliationDiscrepancy: existingMeta.reconciliationDiscrepancy,
        } as TransactionDocument,
        -1,
      );
    }

    applyTransactionToProjectionData(proj, tx, 1);

    proj.appliedTxMeta[tx.id] = {
      status: tx.status,
      updatedAt: tx.updatedAt || new Date().toISOString(),
      type: tx.type,
      amount: tx.amount,
      transactionDate: tx.transactionDate,
      reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
    };

    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
  });
}

/**
 * Updates the projection atomically when an internal transfer is created.
 * Both legs (source and destination) are applied consistently together.
 */
export async function recordInternalTransferCreatedInProjection(
  userId: string,
  sourceTx: TransactionDocument,
  destTx: TransactionDocument,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');

  await executeTransaction(db, async (t) => {
    const snap = await t.get(projRef);
    let proj: DashboardProjection;
    if (snap && snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = createEmptyProjection(userId);
    }

    if (!proj.appliedTxMeta) {
      proj.appliedTxMeta = {};
    }

    const sMeta = proj.appliedTxMeta[sourceTx.id];
    const dMeta = proj.appliedTxMeta[destTx.id];

    const sourceAlreadyApplied = sMeta && sMeta.updatedAt === sourceTx.updatedAt && sMeta.status === sourceTx.status;
    const destAlreadyApplied = dMeta && dMeta.updatedAt === destTx.updatedAt && dMeta.status === destTx.status;

    if (sourceAlreadyApplied && destAlreadyApplied) {
      return; // Already applied both legs
    }

    if (sourceTx.status === 'POSTED' && !sourceAlreadyApplied) {
      applyTransactionToProjectionData(proj, sourceTx, 1);
      proj.appliedTxMeta[sourceTx.id] = {
        status: sourceTx.status,
        updatedAt: sourceTx.updatedAt || new Date().toISOString(),
        type: sourceTx.type,
        amount: sourceTx.amount,
        transactionDate: sourceTx.transactionDate,
        reconciliationDiscrepancy: null,
      };
    }

    if (destTx.status === 'POSTED' && !destAlreadyApplied) {
      applyTransactionToProjectionData(proj, destTx, 1);
      proj.appliedTxMeta[destTx.id] = {
        status: destTx.status,
        updatedAt: destTx.updatedAt || new Date().toISOString(),
        type: destTx.type,
        amount: destTx.amount,
        transactionDate: destTx.transactionDate,
        reconciliationDiscrepancy: null,
      };
    }

    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
  });
}

/**
 * Updates the projection atomically when a transaction is edited.
 * Handles date changes, amount changes, and type changes.
 * Accurately updates earliestTransactionDate if the earliest transaction is altered.
 */
export async function recordTransactionUpdatedInProjection(
  userId: string,
  oldTx: TransactionDocument,
  newTx: TransactionDocument,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');

  await executeTransaction(db, async (t) => {
    const snap = await t.get(projRef);
    let proj: DashboardProjection;
    if (snap && snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = createEmptyProjection(userId);
    }

    if (!proj.appliedTxMeta) {
      proj.appliedTxMeta = {};
    }

    const existingMeta = proj.appliedTxMeta[newTx.id];
    if (existingMeta && existingMeta.updatedAt === newTx.updatedAt && existingMeta.status === newTx.status) {
      return; // Already applied this update
    }

    const stateToRevert = existingMeta && existingMeta.status === 'POSTED'
      ? {
          type: existingMeta.type,
          amount: existingMeta.amount,
          transactionDate: existingMeta.transactionDate,
          reconciliationDiscrepancy: existingMeta.reconciliationDiscrepancy,
        }
      : (oldTx.status === 'POSTED' ? oldTx : null);

    if (stateToRevert) {
      applyTransactionToProjectionData(
        proj,
        {
          id: oldTx.id,
          userId: oldTx.userId,
          accountId: oldTx.accountId,
          type: stateToRevert.type as TransactionType,
          amount: stateToRevert.amount,
          transactionDate: stateToRevert.transactionDate,
          status: 'POSTED',
          reconciliationDiscrepancy: stateToRevert.reconciliationDiscrepancy,
        } as TransactionDocument,
        -1,
      );
    }

    if (newTx.status === 'POSTED') {
      applyTransactionToProjectionData(proj, newTx, 1);
    }

    proj.appliedTxMeta[newTx.id] = {
      status: newTx.status,
      updatedAt: newTx.updatedAt || new Date().toISOString(),
      type: newTx.type,
      amount: newTx.amount,
      transactionDate: newTx.transactionDate,
      reconciliationDiscrepancy: newTx.reconciliationDiscrepancy ?? null,
    };

    // If earliest transaction was modified (date moved forward or voided), recalculate earliest
    const earliest = proj.lifetime.earliestTransactionDate;
    if (earliest && (oldTx.transactionDate <= earliest || newTx.transactionDate < earliest)) {
      proj.lifetime.earliestTransactionDate = await resolveEarliestTransactionDate(userId, txCol);
    }

    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
  });
}

/**
 * Updates the projection atomically when a single transaction is voided.
 * Updates earliestTransactionDate if the voided transaction had the earliest date.
 */
export async function recordTransactionVoidedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');

  await executeTransaction(db, async (t) => {
    const snap = await t.get(projRef);
    let proj: DashboardProjection;
    if (snap && snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = createEmptyProjection(userId);
    }

    if (!proj.appliedTxMeta) {
      proj.appliedTxMeta = {};
    }

    const existingMeta = proj.appliedTxMeta[tx.id];
    if (existingMeta && existingMeta.status === 'VOIDED') {
      return; // Already voided
    }

    const stateToRevert = existingMeta && existingMeta.status === 'POSTED'
      ? {
          type: existingMeta.type,
          amount: existingMeta.amount,
          transactionDate: existingMeta.transactionDate,
          reconciliationDiscrepancy: existingMeta.reconciliationDiscrepancy,
        }
      : (tx.status === 'POSTED' ? tx : null);

    if (stateToRevert) {
      applyTransactionToProjectionData(
        proj,
        {
          id: tx.id,
          userId: tx.userId,
          accountId: tx.accountId,
          type: stateToRevert.type as TransactionType,
          amount: stateToRevert.amount,
          transactionDate: stateToRevert.transactionDate,
          status: 'POSTED',
          reconciliationDiscrepancy: stateToRevert.reconciliationDiscrepancy,
        } as TransactionDocument,
        -1,
      );
    }

    proj.appliedTxMeta[tx.id] = {
      status: 'VOIDED',
      updatedAt: tx.updatedAt || new Date().toISOString(),
      type: tx.type,
      amount: tx.amount,
      transactionDate: tx.transactionDate,
      reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
    };

    const earliest = proj.lifetime.earliestTransactionDate;
    if (earliest && tx.transactionDate <= earliest) {
      proj.lifetime.earliestTransactionDate = await resolveEarliestTransactionDate(userId, txCol);
    }

    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
  });
}

/**
 * Updates the projection atomically when multiple transactions (e.g. transfer legs) are voided.
 */
export async function recordTransactionsVoidedInProjection(
  userId: string,
  txList: TransactionDocument[],
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');

  await executeTransaction(db, async (t) => {
    const snap = await t.get(projRef);
    let proj: DashboardProjection;
    if (snap && snap.exists) {
      proj = snap.data() as DashboardProjection;
    } else {
      proj = createEmptyProjection(userId);
    }

    if (!proj.appliedTxMeta) {
      proj.appliedTxMeta = {};
    }

    let needsEarliestResolution = false;
    const earliest = proj.lifetime.earliestTransactionDate;

    for (const tx of txList) {
      const existingMeta = proj.appliedTxMeta[tx.id];
      if (existingMeta && existingMeta.status === 'VOIDED') {
        continue;
      }

      const stateToRevert = existingMeta && existingMeta.status === 'POSTED'
        ? {
            type: existingMeta.type,
            amount: existingMeta.amount,
            transactionDate: existingMeta.transactionDate,
            reconciliationDiscrepancy: existingMeta.reconciliationDiscrepancy,
          }
        : (tx.status === 'POSTED' ? tx : null);

      if (stateToRevert) {
        applyTransactionToProjectionData(
          proj,
          {
            id: tx.id,
            userId: tx.userId,
            accountId: tx.accountId,
            type: stateToRevert.type as TransactionType,
            amount: stateToRevert.amount,
            transactionDate: stateToRevert.transactionDate,
            status: 'POSTED',
            reconciliationDiscrepancy: stateToRevert.reconciliationDiscrepancy,
          } as TransactionDocument,
          -1,
        );
      }

      proj.appliedTxMeta[tx.id] = {
        status: 'VOIDED',
        updatedAt: tx.updatedAt || new Date().toISOString(),
        type: tx.type,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
      };

      if (earliest && tx.transactionDate <= earliest) {
        needsEarliestResolution = true;
      }
    }

    if (needsEarliestResolution) {
      proj.lifetime.earliestTransactionDate = await resolveEarliestTransactionDate(userId, txCol);
    }

    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
  });
}

/**
 * Rebuilds the user's dashboard projection completely from the canonical transaction ledger.
 * Guarded against concurrent ledger writes during the rebuild window.
 */
export async function rebuildProjectionFromLedger(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');

  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    const rebuildStartTime = new Date().toISOString();
    const snap = await txCol.where('status', '==', 'POSTED').get();

    const proj = createEmptyProjection(userId);
    const txDocs = (snap.docs || []).map((d) => d.data() as TransactionDocument);

    txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    for (const tx of txDocs) {
      applyTransactionToProjectionData(proj, tx, 1);
      proj.appliedTxMeta[tx.id] = {
        status: tx.status,
        updatedAt: tx.updatedAt || new Date().toISOString(),
        type: tx.type,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
      };
    }

    proj.rebuiltAt = rebuildStartTime;
    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    let conflict = false;
    await executeTransaction(db, async (t) => {
      const currentSnap = await t.get(projRef);
      if (currentSnap && currentSnap.exists) {
        const currentData = currentSnap.data() as DashboardProjection;
        // If an update occurred after we started reading the ledger, this rebuild snapshot is stale
        if (currentData.updatedAt && currentData.updatedAt > rebuildStartTime) {
          conflict = true;
          return;
        }
      }
      t.set(projRef, proj as unknown as Record<string, unknown>);
    });

    if (!conflict) {
      return proj;
    }
  }

  // Fallback: final direct write if retries exhausted
  const finalSnap = await txCol.where('status', '==', 'POSTED').get();
  const proj = createEmptyProjection(userId);
  const txDocs = (finalSnap.docs || []).map((d) => d.data() as TransactionDocument);
  txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  for (const tx of txDocs) {
    applyTransactionToProjectionData(proj, tx, 1);
    proj.appliedTxMeta[tx.id] = {
      status: tx.status,
      updatedAt: tx.updatedAt || new Date().toISOString(),
      type: tx.type,
      amount: tx.amount,
      transactionDate: tx.transactionDate,
      reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
    };
  }

  proj.rebuiltAt = new Date().toISOString();
  proj.updatedAt = new Date().toISOString();
  proj.isStale = false;
  proj.staleReason = null;

  await projRef.set(proj as unknown as Record<string, unknown>);
  return proj;
}

/**
 * Retrieves the stored projection document. If not yet initialized or marked stale,
 * repairs it by rebuilding from the canonical transaction ledger.
 */
export async function getOrBuildProjection(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  try {
    const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
    const snap = await projRef.get();
    if (snap && snap.exists) {
      const proj = snap.data() as DashboardProjection;
      if (!proj.isStale) {
        return proj;
      }
      console.warn(
        `Projection for user ${userId} is stale (${proj.staleReason || 'unspecified'}), initiating automatic repair rebuild`,
      );
    }
  } catch (err) {
    console.warn(`Failed reading projection for user ${userId}, rebuilding:`, err);
  }

  return rebuildProjectionFromLedger(userId);
}

/**
 * Verifies that the stored projection is 100% consistent with the canonical transaction ledger.
 * Checks all projected lifetime fields, debt liabilities, and every monthly summary breakdown.
 */
export async function verifyProjectionConsistency(userId: string): Promise<ConsistencyVerificationResult> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const stored = await getOrBuildProjection(userId);

  // Recalculate freshly from canonical transaction ledger
  const txCol = db.collection('users').doc(userId).collection('transactions');
  const snap = await txCol.where('status', '==', 'POSTED').get();
  const txDocs = (snap.docs || []).map((d) => d.data() as TransactionDocument);
  txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const expected = createEmptyProjection(userId);
  for (const tx of txDocs) {
    applyTransactionToProjectionData(expected, tx, 1);
  }

  const discrepancies: string[] = [];

  if (stored.isStale) {
    discrepancies.push(`Projection is marked stale: ${stored.staleReason || 'unspecified'}`);
  }

  // 1. Comprehensive verification of all lifetime fields
  const lifetimeFields: (keyof DashboardProjection['lifetime'])[] = [
    'grossIncome',
    'netTaxPaid',
    'consumptionExpenses',
    'nonFinancialAssetPurchases',
    'investmentAllocation',
    'moneyLent',
    'receivableRepayments',
    'borrowings',
    'debtRepayments',
    'reconciliationAdjustments',
    'totalPostedTransactions',
    'earliestTransactionDate',
  ];

  for (const field of lifetimeFields) {
    if (stored.lifetime[field] !== expected.lifetime[field]) {
      discrepancies.push(
        `lifetime.${field} mismatch: stored ${stored.lifetime[field]} vs expected ${expected.lifetime[field]}`,
      );
    }
  }

  // 2. Comprehensive verification of all debt fields
  const debtFields: (keyof DashboardProjection['debt'])[] = [
    'cumulativeDebtBorrowing',
    'cumulativeDebtRepayment',
    'outstandingDebtLiability',
  ];

  for (const field of debtFields) {
    if (stored.debt[field] !== expected.debt[field]) {
      discrepancies.push(
        `debt.${field} mismatch: stored ${stored.debt[field]} vs expected ${expected.debt[field]}`,
      );
    }
  }

  // 3. Comprehensive verification of all monthly summary fields
  const allMonths = new Set([
    ...Object.keys(stored.monthlySummaries || {}),
    ...Object.keys(expected.monthlySummaries || {}),
  ]);

  const monthlyFields: (keyof MonthlySummaryProjection)[] = [
    'grossIncome',
    'netTaxPaid',
    'consumptionExpenses',
    'nonFinancialAssetPurchases',
    'investmentAllocation',
    'borrowings',
    'debtRepayments',
    'moneyLent',
    'receivableRepayments',
    'reconciliationAdjustments',
  ];

  for (const month of allMonths) {
    const sMonth = stored.monthlySummaries?.[month];
    const eMonth = expected.monthlySummaries?.[month];

    if (!sMonth && eMonth) {
      discrepancies.push(`monthlySummaries[${month}] missing in stored projection`);
      continue;
    }
    if (sMonth && !eMonth) {
      discrepancies.push(`monthlySummaries[${month}] extra unexpected month in stored projection`);
      continue;
    }
    if (sMonth && eMonth) {
      for (const mField of monthlyFields) {
        if (sMonth[mField] !== eMonth[mField]) {
          discrepancies.push(
            `monthlySummaries[${month}].${mField} mismatch: stored ${sMonth[mField]} vs expected ${eMonth[mField]}`,
          );
        }
      }
    }
  }

  return {
    isConsistent: discrepancies.length === 0,
    discrepancies,
    storedProjection: stored,
    recalculatedProjection: expected,
  };
}
