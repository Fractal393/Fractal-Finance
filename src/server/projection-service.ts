import { getFirebaseAdmin } from './firebase-admin.js';
import type { TransactionDocument } from './transaction-service.js';
import type { TransactionType } from './reporting-semantics.js';
import type {
  Transaction as FirestoreTransaction,
  CollectionReference as FirestoreCollectionReference,
  DocumentReference as FirestoreDocumentReference,
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

export interface ProjectionTxMarker {
  txId: string;
  version: number;
  lastEventId: string;
  status: 'POSTED' | 'VOIDED' | 'DRAFT';
  type: TransactionType;
  amount: number;
  transactionDate: string;
  reconciliationDiscrepancy?: number | null;
  updatedAt: string;
}

// Backward-compatible alias
export type AppliedTxMeta = ProjectionTxMarker;

export interface DashboardProjection {
  userId: string;
  version: number;
  generation: number;
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
}

export type ProjectionEventType =
  | 'TX_CREATED'
  | 'TRANSFER_CREATED'
  | 'TX_UPDATED'
  | 'TX_VOIDED'
  | 'TRANSFERS_VOIDED';

export interface ProjectionMutationEvent {
  eventId: string;
  userId: string;
  eventType: ProjectionEventType;
  createdAt: string;
  txId: string;
  version: number;
  tx?: TransactionDocument;
  oldTx?: TransactionDocument;
  newTx?: TransactionDocument;
  sourceTx?: TransactionDocument;
  destTx?: TransactionDocument;
  txList?: TransactionDocument[];
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
    generation: 1,
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
    delete: (ref: { delete: () => Promise<unknown> | void }) => ref.delete(),
  };
  return updateFunction(simulated as unknown as FirestoreTransaction);
}

/**
 * Resolves the earliest POSTED transaction date from the canonical ledger using an indexed query.
 * Executed safely outside transaction callbacks.
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
 * Updates earliestTransactionDate in-memory inside the transaction snapshot safely.
 */
function updateEarliestDateSafely(
  proj: DashboardProjection,
  candidateEarliest: string | null,
  newPostedDate: string | null,
  oldDate?: string,
): void {
  if (proj.lifetime.totalPostedTransactions <= 0) {
    proj.lifetime.earliestTransactionDate = null;
    return;
  }

  let earliest = candidateEarliest;

  if (newPostedDate) {
    if (!earliest || newPostedDate < earliest) {
      earliest = newPostedDate;
    }
  }

  // Preserve valid existing date if it wasn't the transaction being altered
  const current = proj.lifetime.earliestTransactionDate;
  if (current && current !== oldDate) {
    if (!earliest || current < earliest) {
      earliest = current;
    }
  }

  proj.lifetime.earliestTransactionDate = earliest;
}

/**
 * Reverts a marker's previously posted state from projection data.
 */
function revertMarkerFromProjection(
  proj: DashboardProjection,
  marker: ProjectionTxMarker,
): void {
  if (marker.status !== 'POSTED') return;
  const simulatedTx: TransactionDocument = {
    id: marker.txId,
    userId: proj.userId,
    accountId: '',
    type: marker.type,
    amount: marker.amount,
    transactionDate: marker.transactionDate,
    status: 'POSTED',
    reconciliationDiscrepancy: marker.reconciliationDiscrepancy,
    categoryId: null,
    counterpartyId: null,
    transferGroupId: null,
    allocations: [],
    tags: [],
    notes: '',
    description: '',
    createdAt: marker.updatedAt,
    updatedAt: marker.updatedAt,
  };
  applyTransactionToProjectionData(proj, simulatedTx, -1);
}

/**
 * Generates an outbox mutation event document reference and typed payload.
 * Used by ledger mutation transactions to atomically commit outbox events with ledger changes.
 */
export function createProjectionMutationEventRef(
  db: FirebaseFirestore.Firestore,
  userId: string,
  eventData: Omit<ProjectionMutationEvent, 'eventId' | 'createdAt'> & { eventId?: string; createdAt?: string },
): { eventRef: FirestoreDocumentReference; eventDoc: ProjectionMutationEvent } {
  const eventId =
    eventData.eventId ||
    `evt_${eventData.txId}_v${eventData.version}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const eventDoc: ProjectionMutationEvent = {
    ...eventData,
    eventId,
    createdAt: eventData.createdAt || new Date().toISOString(),
  };
  const eventRef = db.collection('users').doc(userId).collection('projectionOutbox').doc(eventId);
  return { eventRef: eventRef as unknown as FirestoreDocumentReference, eventDoc };
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
 * Applies a durable projection mutation event atomically to the dashboard projection
 * and per-transaction marker, then deletes the outbox event upon completion.
 * Fully idempotent against retries and duplicate events.
 */
export async function applyProjectionMutationEvent(
  userId: string,
  event: ProjectionMutationEvent,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');

  // Pre-resolve candidate earliest date OUTSIDE transaction callback if earliest may be affected
  let candidateEarliest: string | null | undefined = undefined;
  try {
    const preSnap = await projRef.get();
    const currentProj = preSnap.exists ? (preSnap.data() as DashboardProjection) : null;
    const currentEarliest = currentProj?.lifetime?.earliestTransactionDate;

    if (currentEarliest) {
      if (
        (event.eventType === 'TX_VOIDED' && event.tx && event.tx.transactionDate <= currentEarliest) ||
        (event.eventType === 'TX_UPDATED' &&
          event.oldTx &&
          (event.oldTx.transactionDate <= currentEarliest || (event.newTx && event.newTx.transactionDate < currentEarliest))) ||
        (event.eventType === 'TRANSFERS_VOIDED' &&
          event.txList &&
          event.txList.some((t) => t.transactionDate <= currentEarliest))
      ) {
        candidateEarliest = await resolveEarliestTransactionDate(userId, txCol);
      }
    }
  } catch (err) {
    console.warn(`Failed pre-resolving earliest date for event ${event.eventId}:`, err);
  }

  await executeTransaction(db, async (t) => {
    const projSnap = await t.get(projRef);
    const proj: DashboardProjection = projSnap && projSnap.exists
      ? (projSnap.data() as DashboardProjection)
      : createEmptyProjection(userId);

    const outboxRef = db.collection('users').doc(userId).collection('projectionOutbox').doc(event.eventId);

    switch (event.eventType) {
      case 'TX_CREATED': {
        const tx = event.tx;
        if (!tx) break;

        const markerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(tx.id);
        const markerSnap = await t.get(markerRef);
        const marker = markerSnap && markerSnap.exists ? (markerSnap.data() as ProjectionTxMarker) : null;

        // Idempotency: exact event already applied or higher/equal version already posted
        if (marker && (marker.lastEventId === event.eventId || (marker.status === tx.status && marker.version >= event.version))) {
          if (typeof (t as unknown as { delete?: (r: unknown) => void }).delete === 'function') {
            t.delete(outboxRef);
          }
          return;
        }

        if (marker && marker.status === 'POSTED') {
          revertMarkerFromProjection(proj, marker);
        }

        if (tx.status === 'POSTED') {
          applyTransactionToProjectionData(proj, tx, 1);
        }

        const newMarker: ProjectionTxMarker = {
          txId: tx.id,
          version: event.version,
          lastEventId: event.eventId,
          status: tx.status,
          type: tx.type,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
          updatedAt: tx.updatedAt || new Date().toISOString(),
        };

        t.set(markerRef, newMarker as unknown as Record<string, unknown>);
        break;
      }

      case 'TRANSFER_CREATED': {
        const { sourceTx, destTx } = event;
        if (!sourceTx || !destTx) break;

        const sMarkerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(sourceTx.id);
        const dMarkerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(destTx.id);

        const sSnap = await t.get(sMarkerRef);
        const dSnap = await t.get(dMarkerRef);

        const sMarker = sSnap && sSnap.exists ? (sSnap.data() as ProjectionTxMarker) : null;
        const dMarker = dSnap && dSnap.exists ? (dSnap.data() as ProjectionTxMarker) : null;

        const sApplied = sMarker && (sMarker.lastEventId === event.eventId || (sMarker.status === sourceTx.status && sMarker.version >= event.version));
        const dApplied = dMarker && (dMarker.lastEventId === event.eventId || (dMarker.status === destTx.status && dMarker.version >= event.version));

        if (sApplied && dApplied) {
          if (typeof (t as unknown as { delete?: (r: unknown) => void }).delete === 'function') {
            t.delete(outboxRef);
          }
          return;
        }

        if (sourceTx.status === 'POSTED' && !sApplied) {
          if (sMarker && sMarker.status === 'POSTED') revertMarkerFromProjection(proj, sMarker);
          applyTransactionToProjectionData(proj, sourceTx, 1);
          t.set(sMarkerRef, {
            txId: sourceTx.id,
            version: event.version,
            lastEventId: event.eventId,
            status: sourceTx.status,
            type: sourceTx.type,
            amount: sourceTx.amount,
            transactionDate: sourceTx.transactionDate,
            reconciliationDiscrepancy: null,
            updatedAt: sourceTx.updatedAt || new Date().toISOString(),
          } as unknown as Record<string, unknown>);
        }

        if (destTx.status === 'POSTED' && !dApplied) {
          if (dMarker && dMarker.status === 'POSTED') revertMarkerFromProjection(proj, dMarker);
          applyTransactionToProjectionData(proj, destTx, 1);
          t.set(dMarkerRef, {
            txId: destTx.id,
            version: event.version,
            lastEventId: event.eventId,
            status: destTx.status,
            type: destTx.type,
            amount: destTx.amount,
            transactionDate: destTx.transactionDate,
            reconciliationDiscrepancy: null,
            updatedAt: destTx.updatedAt || new Date().toISOString(),
          } as unknown as Record<string, unknown>);
        }
        break;
      }

      case 'TX_UPDATED': {
        const { oldTx, newTx } = event;
        if (!newTx) break;

        const markerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(newTx.id);
        const markerSnap = await t.get(markerRef);
        const marker = markerSnap && markerSnap.exists ? (markerSnap.data() as ProjectionTxMarker) : null;

        if (marker && (marker.lastEventId === event.eventId || marker.version >= event.version)) {
          if (typeof (t as unknown as { delete?: (r: unknown) => void }).delete === 'function') {
            t.delete(outboxRef);
          }
          return;
        }

        if (marker && marker.status === 'POSTED') {
          revertMarkerFromProjection(proj, marker);
        } else if (oldTx && oldTx.status === 'POSTED') {
          applyTransactionToProjectionData(proj, oldTx, -1);
        }

        if (newTx.status === 'POSTED') {
          applyTransactionToProjectionData(proj, newTx, 1);
        }

        if (candidateEarliest !== undefined) {
          updateEarliestDateSafely(
            proj,
            candidateEarliest,
            newTx.status === 'POSTED' ? newTx.transactionDate : null,
            oldTx?.transactionDate,
          );
        }

        const newMarker: ProjectionTxMarker = {
          txId: newTx.id,
          version: event.version,
          lastEventId: event.eventId,
          status: newTx.status,
          type: newTx.type,
          amount: newTx.amount,
          transactionDate: newTx.transactionDate,
          reconciliationDiscrepancy: newTx.reconciliationDiscrepancy ?? null,
          updatedAt: newTx.updatedAt || new Date().toISOString(),
        };

        t.set(markerRef, newMarker as unknown as Record<string, unknown>);
        break;
      }

      case 'TX_VOIDED': {
        const tx = event.tx;
        if (!tx) break;

        const markerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(tx.id);
        const markerSnap = await t.get(markerRef);
        const marker = markerSnap && markerSnap.exists ? (markerSnap.data() as ProjectionTxMarker) : null;

        if (marker && (marker.lastEventId === event.eventId || (marker.status === 'VOIDED' && marker.version >= event.version))) {
          if (typeof (t as unknown as { delete?: (r: unknown) => void }).delete === 'function') {
            t.delete(outboxRef);
          }
          return;
        }

        if (marker && marker.status === 'POSTED') {
          revertMarkerFromProjection(proj, marker);
        } else if (tx.status === 'POSTED') {
          applyTransactionToProjectionData(proj, tx, -1);
        }

        if (candidateEarliest !== undefined) {
          updateEarliestDateSafely(proj, candidateEarliest, null, tx.transactionDate);
        }

        const voidMarker: ProjectionTxMarker = {
          txId: tx.id,
          version: event.version,
          lastEventId: event.eventId,
          status: 'VOIDED',
          type: tx.type,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          reconciliationDiscrepancy: tx.reconciliationDiscrepancy ?? null,
          updatedAt: new Date().toISOString(),
        };

        t.set(markerRef, voidMarker as unknown as Record<string, unknown>);
        break;
      }

      case 'TRANSFERS_VOIDED': {
        const txList = event.txList || [];
        for (const tx of txList) {
          const markerRef = db.collection('users').doc(userId).collection('projectionMarkers').doc(tx.id);
          const markerSnap = await t.get(markerRef);
          const marker = markerSnap && markerSnap.exists ? (markerSnap.data() as ProjectionTxMarker) : null;

          if (marker && (marker.lastEventId === event.eventId || (marker.status === 'VOIDED' && marker.version >= event.version))) {
            continue;
          }

          if (marker && marker.status === 'POSTED') {
            revertMarkerFromProjection(proj, marker);
          } else if (tx.status === 'POSTED') {
            applyTransactionToProjectionData(proj, tx, -1);
          }

          t.set(markerRef, {
            txId: tx.id,
            version: event.version,
            lastEventId: event.eventId,
            status: 'VOIDED',
            type: tx.type,
            amount: tx.amount,
            transactionDate: tx.transactionDate,
            reconciliationDiscrepancy: null,
            updatedAt: new Date().toISOString(),
          } as unknown as Record<string, unknown>);
        }

        if (candidateEarliest !== undefined) {
          updateEarliestDateSafely(proj, candidateEarliest, null);
        }
        break;
      }
    }

    proj.version = (proj.version || 1) + 1;
    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    t.set(projRef, proj as unknown as Record<string, unknown>);
    if (typeof (t as unknown as { delete?: (r: unknown) => void }).delete === 'function') {
      t.delete(outboxRef);
    }
  });
}

/**
 * Drains pending projection outbox events.
 */
export async function drainProjectionOutbox(
  userId: string,
  providedDocs?: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) return;

  const outboxCol = db.collection('users').doc(userId).collection('projectionOutbox');
  let docs: FirebaseFirestore.DocumentSnapshot[];

  if (providedDocs) {
    docs = providedDocs;
  } else {
    try {
      const snap = await outboxCol.orderBy('createdAt', 'asc').limit(50).get();
      docs = snap.docs || [];
    } catch {
      const snap = await outboxCol.limit(50).get();
      docs = snap.docs || [];
    }
  }

  for (const doc of docs) {
    const event = doc.data() as ProjectionMutationEvent;
    if (!event) continue;
    try {
      await applyProjectionMutationEvent(userId, event);
    } catch (err) {
      console.error(`Failed to drain projection outbox event ${event.eventId}:`, err);
      await markProjectionStale(
        userId,
        `OUTBOX_DRAIN_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }
}

/**
 * Updates the projection atomically when a transaction is created.
 */
export async function recordTransactionCreatedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  if (tx.status !== 'POSTED') return;
  const version = tx.version || 1;
  const eventId = tx.lastEventId || `evt_${tx.id}_v${version}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const event: ProjectionMutationEvent = {
    eventId,
    userId,
    eventType: 'TX_CREATED',
    createdAt: tx.createdAt || new Date().toISOString(),
    txId: tx.id,
    version,
    tx,
  };
  await applyProjectionMutationEvent(userId, event);
}

/**
 * Updates the projection atomically when an internal transfer is created.
 */
export async function recordInternalTransferCreatedInProjection(
  userId: string,
  sourceTx: TransactionDocument,
  destTx: TransactionDocument,
): Promise<void> {
  const transferGroupId = sourceTx.transferGroupId || `xfer_${sourceTx.id}_${destTx.id}`;
  const eventId = `evt_xfer_${transferGroupId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const event: ProjectionMutationEvent = {
    eventId,
    userId,
    eventType: 'TRANSFER_CREATED',
    createdAt: sourceTx.createdAt || new Date().toISOString(),
    txId: transferGroupId,
    version: 1,
    sourceTx,
    destTx,
  };
  await applyProjectionMutationEvent(userId, event);
}

/**
 * Updates the projection atomically when a transaction is edited.
 */
export async function recordTransactionUpdatedInProjection(
  userId: string,
  oldTx: TransactionDocument,
  newTx: TransactionDocument,
): Promise<void> {
  const version = newTx.version || (oldTx.version || 1) + 1;
  const eventId = newTx.lastEventId || `evt_${newTx.id}_v${version}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const event: ProjectionMutationEvent = {
    eventId,
    userId,
    eventType: 'TX_UPDATED',
    createdAt: newTx.updatedAt || new Date().toISOString(),
    txId: newTx.id,
    version,
    oldTx,
    newTx,
  };
  await applyProjectionMutationEvent(userId, event);
}

/**
 * Updates the projection atomically when a single transaction is voided.
 */
export async function recordTransactionVoidedInProjection(
  userId: string,
  tx: TransactionDocument,
): Promise<void> {
  const version = (tx.version || 1) + 1;
  const eventId = tx.lastEventId || `evt_void_${tx.id}_v${version}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const event: ProjectionMutationEvent = {
    eventId,
    userId,
    eventType: 'TX_VOIDED',
    createdAt: new Date().toISOString(),
    txId: tx.id,
    version,
    tx,
  };
  await applyProjectionMutationEvent(userId, event);
}

/**
 * Updates the projection atomically when multiple transactions (e.g. transfer legs) are voided.
 */
export async function recordTransactionsVoidedInProjection(
  userId: string,
  txList: TransactionDocument[],
): Promise<void> {
  const txId = txList[0]?.transferGroupId || txList[0]?.id || 'multi_void';
  const eventId = `evt_void_list_${txId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const event: ProjectionMutationEvent = {
    eventId,
    userId,
    eventType: 'TRANSFERS_VOIDED',
    createdAt: new Date().toISOString(),
    txId,
    version: 1,
    txList,
  };
  await applyProjectionMutationEvent(userId, event);
}

/**
 * Rebuilds the user's dashboard projection completely from the canonical transaction ledger.
 * Guarded by optimistic generation & timestamp fencing.
 * No unconditional direct-write fallback: aborts safely if concurrent mutations continuously conflict.
 */
export async function rebuildProjectionFromLedger(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const txCol = db.collection('users').doc(userId).collection('transactions');
  const outboxCol = db.collection('users').doc(userId).collection('projectionOutbox');

  const MAX_RETRY_ATTEMPTS = 5;
  let attempts = 0;

  while (attempts < MAX_RETRY_ATTEMPTS) {
    attempts++;
    const rebuildStartTime = new Date().toISOString();

    // Read current projection generation fencing token before reading ledger
    const preSnap = await projRef.get();
    const preData = preSnap.exists ? (preSnap.data() as DashboardProjection) : null;
    const expectedGeneration = preData?.generation ?? 0;

    // Read canonical ledger
    const snap = await txCol.where('status', '==', 'POSTED').get();
    const txDocs = (snap.docs || []).map((d) => d.data() as TransactionDocument);
    txDocs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    const proj = createEmptyProjection(userId);
    for (const tx of txDocs) {
      applyTransactionToProjectionData(proj, tx, 1);
    }

    proj.generation = expectedGeneration + 1;
    proj.rebuiltAt = rebuildStartTime;
    proj.updatedAt = new Date().toISOString();
    proj.isStale = false;
    proj.staleReason = null;

    let conflict = false;
    try {
      await executeTransaction(db, async (t) => {
        const currentSnap = await t.get(projRef);
        if (currentSnap && currentSnap.exists) {
          const currentData = currentSnap.data() as DashboardProjection;
          // Fencing: If an update occurred after we started reading the ledger, or if generation changed:
          if (
            (currentData.updatedAt && currentData.updatedAt > rebuildStartTime) ||
            (currentData.generation !== undefined && currentData.generation !== expectedGeneration)
          ) {
            conflict = true;
            return;
          }
        }
        t.set(projRef, proj as unknown as Record<string, unknown>);
      });
    } catch {
      conflict = true;
    }

    if (!conflict) {
      // Rebuild succeeded under fencing!
      // Clean up any outbox events created before rebuild started
      try {
        const pendingOutbox = await outboxCol.get();
        if (pendingOutbox && !pendingOutbox.empty && pendingOutbox.docs) {
          for (const d of pendingOutbox.docs) {
            const evt = d.data() as ProjectionMutationEvent;
            if (evt && evt.createdAt <= rebuildStartTime) {
              await d.ref.delete();
            }
          }
        }
      } catch (err) {
        console.warn(`Failed cleaning outbox after rebuild for user ${userId}:`, err);
      }

      return proj;
    }

    // Exponential backoff before next attempt
    if (attempts < MAX_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempts * 50));
    }
  }

  // Fencing check: NO direct write fallback!
  // If retries are exhausted due to continuous concurrent mutations, mark stale and throw error
  await markProjectionStale(
    userId,
    'REBUILD_CONFLICT: Continuous concurrent ledger mutations prevented atomic rebuild fencing',
  );
  throw new Error(
    `Projection rebuild aborted after ${MAX_RETRY_ATTEMPTS} attempts due to concurrent ledger mutations. Fencing prevented overwriting newer projection state.`,
  );
}

/**
 * Retrieves the stored projection document. If not yet initialized, has pending outbox events,
 * or is marked stale, repairs it by draining outbox or rebuilding from the canonical transaction ledger.
 */
export async function getOrBuildProjection(userId: string): Promise<DashboardProjection> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const projRef = db.collection('users').doc(userId).collection('projections').doc('dashboard');
  const outboxCol = db.collection('users').doc(userId).collection('projectionOutbox');

  // Check for any pending unapplied mutation events (e.g. process was killed after ledger write)
  try {
    let pendingSnap = null;
    if (typeof outboxCol.limit === 'function') {
      pendingSnap = await outboxCol.limit(50).get();
    } else if (typeof outboxCol.get === 'function') {
      pendingSnap = await outboxCol.get();
    }
    if (pendingSnap && !pendingSnap.empty && pendingSnap.docs && pendingSnap.docs.length > 0) {
      await drainProjectionOutbox(userId, pendingSnap.docs as FirebaseFirestore.QueryDocumentSnapshot[]);
    }
  } catch (err) {
    console.warn(`Failed checking projection outbox for user ${userId}:`, err);
  }

  // Load projection doc
  try {
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
