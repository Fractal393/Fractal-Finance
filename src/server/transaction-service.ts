import { getFirebaseAdmin } from './firebase-admin.js';
import { createAuditRecord } from './audit-service.js';
import {
  TransactionType,
  TransactionStatus,
  TransferDirection,
  getTransactionBalanceDelta,
} from './reporting-semantics.js';
import { AccountDocument } from './account-service.js';
import {
  recordTransactionCreatedInProjection,
  recordTransactionVoidedInProjection,
  recordTransactionUpdatedInProjection,
} from './projection-service.js';

export interface SplitAllocation {
  id: string;
  transactionId: string;
  categoryId: string;
  amount: number; // Integer minor units > 0
  tags: string[];
  notes: string;
}

export interface TransactionDocument {
  id: string;
  userId: string;
  accountId: string;
  transactionDate: string; // ISO date YYYY-MM-DD
  amount: number; // Positive integer minor units
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
  reconciliationId?: string | null;
  reconciliationDiscrepancy?: number | null;
  categoryIds?: string[];
  allocations: SplitAllocation[];
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface CreateTransactionInput {
  accountId: string;
  transactionDate: string;
  amount: number; // Integer minor units > 0
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

export interface CreateTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number; // Integer minor units > 0
  transactionDate: string;
  description?: string;
  notes?: string;
  tags?: string[];
  idempotencyKey?: string | null;
}

export interface UpdateTransactionInput {
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

export interface TransactionFilterParams {
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

export interface PaginatedTransactions {
  items: TransactionDocument[];
  nextCursor: string | null;
  hasMore: boolean;
}

function validateISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const parsed = new Date(dateStr);
  return !isNaN(parsed.getTime());
}

/**
 * Validates ownership and active status of an account.
 */
async function validateAccount(userId: string, accountId: string, mustBeActive = true): Promise<AccountDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const ref = db.collection('users').doc(userId).collection('accounts').doc(accountId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new Error(`Account ${accountId} not found or does not belong to user.`);
    (err as unknown as { code: string }).code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  const account = snap.data() as AccountDocument;
  if (account.userId !== userId) {
    const err = new Error('Access denied to account.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }
  if (mustBeActive && !account.isActive) {
    throw new Error(`Account "${account.name}" is archived/inactive and cannot accept transactions.`);
  }

  return account;
}

/**
 * Validates category ownership and active state.
 */
async function validateCategory(userId: string, categoryId: string): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const snap = await db.collection('users').doc(userId).collection('categories').doc(categoryId).get();
  if (!snap.exists) {
    throw new Error(`Category ${categoryId} not found or does not belong to user.`);
  }
  const cat = snap.data();
  if (cat && !cat['isActive']) {
    throw new Error(`Category "${cat['name']}" is inactive and cannot be assigned.`);
  }
}

/**
 * Validates counterparty ownership.
 */
async function validateCounterparty(userId: string, counterpartyId: string): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const snap = await db.collection('users').doc(userId).collection('counterparties').doc(counterpartyId).get();
  if (!snap.exists) {
    throw new Error(`Counterparty ${counterpartyId} not found or does not belong to user.`);
  }
}

/**
 * Creates a standard or split transaction.
 * Updates calculated account balance atomically.
 * Enforces server-side validations and logs audit entry.
 */
export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
): Promise<TransactionDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  // Basic validations
  if (!input.accountId) throw new Error('Account ID is required.');
  if (!input.amount || typeof input.amount !== 'number' || !Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Transaction amount must be a positive integer in minor units (e.g. paise).');
  }
  if (!input.type) throw new Error('Transaction type is required.');
  if (input.type === 'INTERNAL_TRANSFER') {
    throw new Error("Use the dedicated transfer API to create paired internal transfers.");
  }
  if (!input.transactionDate || !validateISODate(input.transactionDate)) {
    throw new Error('Valid transaction date (YYYY-MM-DD) is required.');
  }
  if (!input.description || typeof input.description !== 'string' || input.description.trim().length === 0) {
    throw new Error('Transaction description is required.');
  }

  // Idempotency check
  if (input.idempotencyKey) {
    const existingSnap = await db
      .collection('users')
      .doc(userId)
      .collection('transactions')
      .where('idempotencyKey', '==', input.idempotencyKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return existingSnap.docs[0].data() as TransactionDocument;
    }
  }

  // Validate account
  await validateAccount(userId, input.accountId);

  // Validate category if provided
  if (input.categoryId) {
    await validateCategory(userId, input.categoryId);
  }

  // Validate counterparty if provided
  if (input.counterpartyId) {
    await validateCounterparty(userId, input.counterpartyId);
  }

  // Validate splits if provided
  const allocations: SplitAllocation[] = [];
  const txRef = db.collection('users').doc(userId).collection('transactions').doc();
  const txId = txRef.id;

  if (input.allocations && input.allocations.length > 0) {
    let sumAllocations = 0;
    for (let i = 0; i < input.allocations.length; i++) {
      const a = input.allocations[i];
      if (!a.amount || typeof a.amount !== 'number' || !Number.isInteger(a.amount) || a.amount <= 0) {
        throw new Error(`Split allocation ${i + 1} must have a positive integer amount.`);
      }
      if (!a.categoryId) {
        throw new Error(`Split allocation ${i + 1} requires a valid category.`);
      }
      await validateCategory(userId, a.categoryId);
      sumAllocations += a.amount;

      allocations.push({
        id: `alloc_${i + 1}`,
        transactionId: txId,
        categoryId: a.categoryId,
        amount: a.amount,
        tags: Array.isArray(a.tags) ? a.tags.map((t) => t.trim().toLowerCase()) : [],
        notes: a.notes?.trim() || '',
      });
    }

    if (sumAllocations !== input.amount) {
      throw new Error(
        `Split allocations total (${sumAllocations}) must exactly match transaction amount (${input.amount}).`
      );
    }
  }

  const now = new Date().toISOString();
  const balanceDelta = getTransactionBalanceDelta(input.type, input.amount, 'POSTED');

  const categoryIds = Array.from(
    new Set(
      [input.categoryId, ...allocations.map((a) => a.categoryId)].filter(
        (c): c is string => typeof c === 'string' && c.length > 0,
      ),
    ),
  );

  const newTx: TransactionDocument = {
    id: txId,
    userId,
    accountId: input.accountId,
    transactionDate: input.transactionDate.split('T')[0],
    amount: input.amount,
    type: input.type,
    categoryId: input.categoryId || null,
    categoryIds,
    counterpartyId: input.counterpartyId || null,
    description: input.description.trim(),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => t.trim().toLowerCase()) : [],
    notes: input.notes?.trim() || '',
    status: 'POSTED',
    transferGroupId: null,
    allocations,
    idempotencyKey: input.idempotencyKey || null,
    createdAt: now,
    updatedAt: now,
  };

  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(input.accountId);

  await db.runTransaction(async (transaction) => {
    const accSnap = await transaction.get(accountRef);
    if (!accSnap.exists) {
      throw new Error(`Account ${input.accountId} not found.`);
    }
    const accData = accSnap.data() as AccountDocument;
    const updatedCalculated = (accData.calculatedBalance || 0) + balanceDelta;

    transaction.set(txRef, newTx);
    transaction.update(accountRef, {
      calculatedBalance: updatedCalculated,
      updatedAt: now,
    });
  });

  const isSplit = allocations.length > 0;
  await createAuditRecord({
    userId,
    actor: userId,
    action: isSplit ? 'SPLIT_TRANSACTION_CREATED' : 'TRANSACTION_CREATED',
    entityType: 'transaction',
    entityId: newTx.id,
    details: {
      accountId: newTx.accountId,
      amount: newTx.amount,
      type: newTx.type,
      balanceDelta,
      splitCount: allocations.length,
    },
  });

  // Non-blocking projection sync
  recordTransactionCreatedInProjection(userId, newTx).catch((err: unknown) => {
    void err;
  });

  return newTx;
}

/**
 * Creates an atomic internal transfer pairing between two owned accounts.
 * Debits source account and credits destination account with the same transferGroupId.
 */
export async function createInternalTransfer(
  userId: string,
  input: CreateTransferInput,
): Promise<{ sourceTransaction: TransactionDocument; destinationTransaction: TransactionDocument }> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  if (!input.sourceAccountId || !input.destinationAccountId) {
    throw new Error('Both source and destination accounts are required.');
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error('Source and destination accounts must be different.');
  }
  if (!input.amount || typeof input.amount !== 'number' || !Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Transfer amount must be a positive integer in minor units (e.g. paise).');
  }
  if (!input.transactionDate || !validateISODate(input.transactionDate)) {
    throw new Error('Valid transfer date is required.');
  }

  // Validate accounts
  const sourceAccount = await validateAccount(userId, input.sourceAccountId);
  const destAccount = await validateAccount(userId, input.destinationAccountId);

  // Idempotency check
  if (input.idempotencyKey) {
    const existingSnap = await db
      .collection('users')
      .doc(userId)
      .collection('transactions')
      .where('idempotencyKey', '==', input.idempotencyKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const first = existingSnap.docs[0].data() as TransactionDocument;
      if (first.transferGroupId) {
        const pairSnap = await db
          .collection('users')
          .doc(userId)
          .collection('transactions')
          .where('transferGroupId', '==', first.transferGroupId)
          .get();
        const docs = pairSnap.docs.map((d) => d.data() as TransactionDocument);
        const sourceTx = docs.find((d) => d.transferDirection === 'OUT') || docs[0];
        const destTx = docs.find((d) => d.transferDirection === 'IN') || docs[1];
        return { sourceTransaction: sourceTx, destinationTransaction: destTx };
      }
    }
  }

  const txCol = db.collection('users').doc(userId).collection('transactions');
  const sourceRef = txCol.doc();
  const destRef = txCol.doc();
  const transferGroupId = `transfer_${sourceRef.id}`;
  const now = new Date().toISOString();
  const dateStr = input.transactionDate.split('T')[0];

  const sourceDesc = input.description?.trim() || `Transfer to ${destAccount.name}`;
  const destDesc = input.description?.trim() || `Transfer from ${sourceAccount.name}`;

  const sourceTx: TransactionDocument = {
    id: sourceRef.id,
    userId,
    accountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    transactionDate: dateStr,
    amount: input.amount,
    type: 'INTERNAL_TRANSFER',
    transferDirection: 'OUT',
    categoryId: null,
    counterpartyId: null,
    description: sourceDesc,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => t.trim().toLowerCase()) : [],
    notes: input.notes?.trim() || '',
    status: 'POSTED',
    transferGroupId,
    allocations: [],
    idempotencyKey: input.idempotencyKey || null,
    createdAt: now,
    updatedAt: now,
  };

  const destTx: TransactionDocument = {
    id: destRef.id,
    userId,
    accountId: input.destinationAccountId,
    destinationAccountId: input.sourceAccountId,
    transactionDate: dateStr,
    amount: input.amount,
    type: 'INTERNAL_TRANSFER',
    transferDirection: 'IN',
    categoryId: null,
    counterpartyId: null,
    description: destDesc,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => t.trim().toLowerCase()) : [],
    notes: input.notes?.trim() || '',
    status: 'POSTED',
    transferGroupId,
    allocations: [],
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}_in` : null,
    createdAt: now,
    updatedAt: now,
  };

  const sourceAccRef = db.collection('users').doc(userId).collection('accounts').doc(input.sourceAccountId);
  const destAccRef = db.collection('users').doc(userId).collection('accounts').doc(input.destinationAccountId);

  await db.runTransaction(async (transaction) => {
    const sSnap = await transaction.get(sourceAccRef);
    const dSnap = await transaction.get(destAccRef);

    if (!sSnap.exists || !dSnap.exists) {
      throw new Error('One or both accounts could not be retrieved.');
    }

    const sData = sSnap.data() as AccountDocument;
    const dData = dSnap.data() as AccountDocument;

    transaction.set(sourceRef, sourceTx);
    transaction.set(destRef, destTx);

    // Debit source (-amount), Credit destination (+amount)
    transaction.update(sourceAccRef, {
      calculatedBalance: (sData.calculatedBalance || 0) - input.amount,
      updatedAt: now,
    });
    transaction.update(destAccRef, {
      calculatedBalance: (dData.calculatedBalance || 0) + input.amount,
      updatedAt: now,
    });
  });

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'TRANSFER_CREATED',
    entityType: 'transfer',
    entityId: transferGroupId,
    details: {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amount: input.amount,
      sourceTxId: sourceTx.id,
      destTxId: destTx.id,
    },
  });

  // Non-blocking projection sync
  recordTransactionCreatedInProjection(userId, sourceTx).catch((err: unknown) => {
    void err;
  });
  recordTransactionCreatedInProjection(userId, destTx).catch((err: unknown) => {
    void err;
  });

  return { sourceTransaction: sourceTx, destinationTransaction: destTx };
}

/**
 * Updates an existing transaction.
 * Adjusts account calculated balance if amount, type, or account changes.
 */
export async function updateTransaction(
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput,
): Promise<TransactionDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const txRef = db.collection('users').doc(userId).collection('transactions').doc(transactionId);
  const snap = await txRef.get();
  if (!snap.exists) {
    const err = new Error(`Transaction ${transactionId} not found.`);
    (err as unknown as { code: string }).code = 'TRANSACTION_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as TransactionDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied to transaction.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  if (current.status === 'VOIDED') {
    throw new Error('Voided transactions cannot be edited.');
  }

  const updates: Partial<TransactionDocument> = {
    updatedAt: new Date().toISOString(),
  };

  let newAmount = current.amount;
  if (input.amount !== undefined) {
    if (typeof input.amount !== 'number' || !Number.isInteger(input.amount) || input.amount <= 0) {
      throw new Error('Transaction amount must be a positive integer in minor units.');
    }
    newAmount = input.amount;
    updates.amount = newAmount;
  }

  let newType = current.type;
  if (input.type !== undefined) {
    if (input.type === 'INTERNAL_TRANSFER' && current.type !== 'INTERNAL_TRANSFER') {
      throw new Error('Cannot convert standard transaction to internal transfer.');
    }
    newType = input.type;
    updates.type = newType;
  }

  if (input.transactionDate !== undefined) {
    if (!validateISODate(input.transactionDate)) throw new Error('Valid date is required.');
    updates.transactionDate = input.transactionDate.split('T')[0];
  }

  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    if (trimmed.length === 0) throw new Error('Description cannot be empty.');
    updates.description = trimmed;
  }

  if (input.notes !== undefined) {
    updates.notes = input.notes.trim();
  }

  if (input.tags !== undefined) {
    updates.tags = Array.isArray(input.tags) ? input.tags.map((t) => t.trim().toLowerCase()) : [];
  }

  if (input.categoryId !== undefined) {
    if (input.categoryId) {
      await validateCategory(userId, input.categoryId);
    }
    updates.categoryId = input.categoryId || null;
  }

  if (input.counterpartyId !== undefined) {
    if (input.counterpartyId) {
      await validateCounterparty(userId, input.counterpartyId);
    }
    updates.counterpartyId = input.counterpartyId || null;
  }

  // Handle allocations update if passed
  let allocationsChanged = false;
  if (input.allocations !== undefined) {
    const newAllocations: SplitAllocation[] = [];
    let sumAllocations = 0;
    for (let i = 0; i < input.allocations.length; i++) {
      const a = input.allocations[i];
      if (!a.amount || typeof a.amount !== 'number' || !Number.isInteger(a.amount) || a.amount <= 0) {
        throw new Error(`Split allocation ${i + 1} must have a positive integer amount.`);
      }
      if (!a.categoryId) {
        throw new Error(`Split allocation ${i + 1} requires a valid category.`);
      }
      await validateCategory(userId, a.categoryId);
      sumAllocations += a.amount;
      newAllocations.push({
        id: `alloc_${i + 1}`,
        transactionId,
        categoryId: a.categoryId,
        amount: a.amount,
        tags: Array.isArray(a.tags) ? a.tags.map((t) => t.trim().toLowerCase()) : [],
        notes: a.notes?.trim() || '',
      });
    }

    if (newAllocations.length > 0 && sumAllocations !== newAmount) {
      throw new Error(`Split allocations total (${sumAllocations}) must exactly match transaction amount (${newAmount}).`);
    }

    updates.allocations = newAllocations;
    allocationsChanged = true;
  }

  if (input.allocations !== undefined || input.categoryId !== undefined) {
    const activeCat = input.categoryId !== undefined ? input.categoryId : current.categoryId;
    const activeAllocs = input.allocations !== undefined ? updates.allocations || [] : current.allocations || [];
    updates.categoryIds = Array.from(
      new Set(
        [activeCat, ...activeAllocs.map((a) => a.categoryId)].filter(
          (c): c is string => typeof c === 'string' && c.length > 0,
        ),
      ),
    );
  }

  // If part of an internal transfer group, edit both legs and balances atomically
  if (current.transferGroupId) {
    if (input.type !== undefined && input.type !== 'INTERNAL_TRANSFER') {
      throw new Error('Cannot change type of an internal transfer leg.');
    }
    if (input.allocations !== undefined && input.allocations.length > 0) {
      throw new Error('Internal transfers cannot have split allocations.');
    }

    const pairSnap = await db
      .collection('users')
      .doc(userId)
      .collection('transactions')
      .where('transferGroupId', '==', current.transferGroupId)
      .get();

    const pairDocs = pairSnap.docs.map((d) => d.data() as TransactionDocument);
    const sourceTx = pairDocs.find((d) => d.transferDirection === 'OUT') || (current.transferDirection === 'OUT' ? current : null);
    const destTx = pairDocs.find((d) => d.transferDirection === 'IN') || (current.transferDirection === 'IN' ? current : null);

    if (!sourceTx || !destTx) {
      throw new Error('Associated transfer leg not found.');
    }

    const oldAmount = sourceTx.amount;
    const amountDiff = newAmount - oldAmount;

    const sourceRef = db.collection('users').doc(userId).collection('transactions').doc(sourceTx.id);
    const destRef = db.collection('users').doc(userId).collection('transactions').doc(destTx.id);

    const sourceAccRef = db.collection('users').doc(userId).collection('accounts').doc(sourceTx.accountId);
    const destAccRef = db.collection('users').doc(userId).collection('accounts').doc(destTx.accountId);

    await db.runTransaction(async (transaction) => {
      if (amountDiff !== 0) {
        const sSnap = await transaction.get(sourceAccRef);
        const dSnap = await transaction.get(destAccRef);

        if (sSnap.exists) {
          const sAcc = sSnap.data() as AccountDocument;
          transaction.update(sourceAccRef, {
            calculatedBalance: (sAcc.calculatedBalance || 0) - amountDiff,
            updatedAt: updates.updatedAt,
          });
        }
        if (dSnap.exists) {
          const dAcc = dSnap.data() as AccountDocument;
          transaction.update(destAccRef, {
            calculatedBalance: (dAcc.calculatedBalance || 0) + amountDiff,
            updatedAt: updates.updatedAt,
          });
        }
      }

      const commonUpdates: Partial<TransactionDocument> = {
        amount: newAmount,
        updatedAt: updates.updatedAt,
      };
      if (updates.transactionDate) commonUpdates.transactionDate = updates.transactionDate;
      if (updates.notes !== undefined) commonUpdates.notes = updates.notes;
      if (updates.tags !== undefined) commonUpdates.tags = updates.tags;

      transaction.update(sourceRef, commonUpdates);
      transaction.update(destRef, commonUpdates);
    });

    await createAuditRecord({
      userId,
      actor: userId,
      action: 'TRANSFER_EDITED',
      entityType: 'transfer',
      entityId: current.transferGroupId,
      details: {
        previousAmount: oldAmount,
        updatedAmount: newAmount,
        amountDifference: amountDiff,
        sourceAccountId: sourceTx.accountId,
        destinationAccountId: destTx.accountId,
      },
    });

    return {
      ...current,
      ...updates,
      amount: newAmount,
    };
  }

  // Calculate balance change difference
  const oldDelta = getTransactionBalanceDelta(current.type, current.amount, current.status, current.transferDirection);
  const newDelta = getTransactionBalanceDelta(newType, newAmount, 'POSTED', current.transferDirection);
  const balanceDifference = newDelta - oldDelta;

  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(current.accountId);

  await db.runTransaction(async (transaction) => {
    if (balanceDifference !== 0) {
      const accSnap = await transaction.get(accountRef);
      if (accSnap.exists) {
        const accData = accSnap.data() as AccountDocument;
        transaction.update(accountRef, {
          calculatedBalance: (accData.calculatedBalance || 0) + balanceDifference,
          updatedAt: updates.updatedAt,
        });
      }
    }
    transaction.update(txRef, updates);
  });

  const updatedTx: TransactionDocument = { ...current, ...updates };

  // Non-blocking projection sync
  recordTransactionUpdatedInProjection(userId, current, updatedTx).catch((err: unknown) => {
    void err;
  });

  await createAuditRecord({
    userId,
    actor: userId,
    action: allocationsChanged ? 'SPLIT_TRANSACTION_EDITED' : 'TRANSACTION_EDITED',
    entityType: 'transaction',
    entityId: transactionId,
    details: {
      previous: { amount: current.amount, type: current.type, balanceDelta: oldDelta },
      updated: { amount: newAmount, type: newType, balanceDelta: newDelta, balanceDifference },
    },
  });

  return updatedTx;
}

/**
 * Safely voids a transaction without hard-deleting it.
 * Reverses its impact on account calculated balance and logs TRANSACTION_VOIDED.
 * If this is an internal transfer, voids BOTH linked transfer records atomically.
 */
export async function voidTransaction(
  userId: string,
  transactionId: string,
  reason?: string,
): Promise<TransactionDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const txRef = db.collection('users').doc(userId).collection('transactions').doc(transactionId);
  const snap = await txRef.get();
  if (!snap.exists) {
    const err = new Error(`Transaction ${transactionId} not found.`);
    (err as unknown as { code: string }).code = 'TRANSACTION_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as TransactionDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied to transaction.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  if (current.status === 'VOIDED') {
    return current; // Already voided
  }

  const now = new Date().toISOString();
  const voidReason = reason?.trim() || 'User requested void';

  // Check if part of an internal transfer group
  if (current.transferGroupId) {
    const pairSnap = await db
      .collection('users')
      .doc(userId)
      .collection('transactions')
      .where('transferGroupId', '==', current.transferGroupId)
      .get();

    const transferDocs = pairSnap.docs.map((d) => d.data() as TransactionDocument);

    await db.runTransaction(async (transaction) => {
      for (const tDoc of transferDocs) {
        if (tDoc.status !== 'VOIDED') {
          const tRef = db.collection('users').doc(userId).collection('transactions').doc(tDoc.id);
          const aRef = db.collection('users').doc(userId).collection('accounts').doc(tDoc.accountId);
          const aSnap = await transaction.get(aRef);

          if (aSnap.exists) {
            const aData = aSnap.data() as AccountDocument;
            const delta = getTransactionBalanceDelta(tDoc.type, tDoc.amount, 'POSTED', tDoc.transferDirection);
            // Reversing delta
            transaction.update(aRef, {
              calculatedBalance: (aData.calculatedBalance || 0) - delta,
              updatedAt: now,
            });
          }

          transaction.update(tRef, {
            status: 'VOIDED',
            voidedAt: now,
            voidReason,
            updatedAt: now,
          });
        }
      }
    });

    // Non-blocking projection sync for voided transfer legs
    for (const tDoc of transferDocs) {
      if (tDoc.status !== 'VOIDED') {
        recordTransactionVoidedInProjection(userId, tDoc).catch((err: unknown) => {
          void err;
        });
      }
    }

    await createAuditRecord({
      userId,
      actor: userId,
      action: 'TRANSACTION_VOIDED',
      entityType: 'transfer',
      entityId: current.transferGroupId,
      details: {
        reason: voidReason,
        affectedTransactions: transferDocs.map((t) => t.id),
      },
    });

    return {
      ...current,
      status: 'VOIDED',
      voidedAt: now,
      voidReason,
      updatedAt: now,
    };
  }

  // Standard non-transfer transaction voiding
  const previousDelta = getTransactionBalanceDelta(current.type, current.amount, 'POSTED', current.transferDirection);
  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(current.accountId);

  await db.runTransaction(async (transaction) => {
    const accSnap = await transaction.get(accountRef);
    if (accSnap.exists) {
      const accData = accSnap.data() as AccountDocument;
      transaction.update(accountRef, {
        calculatedBalance: (accData.calculatedBalance || 0) - previousDelta,
        updatedAt: now,
      });
    }

    transaction.update(txRef, {
      status: 'VOIDED',
      voidedAt: now,
      voidReason,
      updatedAt: now,
    });
  });

  const voidedTx: TransactionDocument = {
    ...current,
    status: 'VOIDED',
    voidedAt: now,
    voidReason,
    updatedAt: now,
  };

  // Non-blocking projection sync
  recordTransactionVoidedInProjection(userId, current).catch((err: unknown) => {
    void err;
  });

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'TRANSACTION_VOIDED',
    entityType: 'transaction',
    entityId: transactionId,
    details: {
      accountId: current.accountId,
      amount: current.amount,
      type: current.type,
      reversedDelta: -previousDelta,
      reason: voidReason,
    },
  });

  return voidedTx;
}

/**
 * Retrieves a single transaction by ID.
 */
export async function getTransaction(userId: string, transactionId: string): Promise<TransactionDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const snap = await db.collection('users').doc(userId).collection('transactions').doc(transactionId).get();
  if (!snap.exists) {
    const err = new Error(`Transaction ${transactionId} not found.`);
    (err as unknown as { code: string }).code = 'TRANSACTION_NOT_FOUND';
    throw err;
  }

  const tx = snap.data() as TransactionDocument;
  if (tx.userId !== userId) {
    const err = new Error('Access denied to transaction.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  return tx;
}

/**
 * Retrieves paginated transactions with flexible filtering.
 */
export async function getTransactions(
  userId: string,
  params: TransactionFilterParams = {},
): Promise<PaginatedTransactions> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const col = db.collection('users').doc(userId).collection('transactions');
  let query: FirebaseFirestore.Query = col;

  if (params.accountId) {
    query = query.where('accountId', '==', params.accountId);
  }
  if (params.type) {
    query = query.where('type', '==', params.type);
  }
  if (params.status && params.status !== 'ALL') {
    query = query.where('status', '==', params.status);
  }
  if (params.counterpartyId) {
    query = query.where('counterpartyId', '==', params.counterpartyId);
  }
  if (params.categoryId) {
    query = query.where('categoryIds', 'array-contains', params.categoryId);
  }
  if (params.tag) {
    const normalizedTag = params.tag.trim().toLowerCase();
    query = query.where('tags', 'array-contains', normalizedTag);
  }
  if (params.startDate) {
    query = query.where('transactionDate', '>=', params.startDate);
  }
  if (params.endDate) {
    query = query.where('transactionDate', '<=', params.endDate);
  }

  // Order descending by transactionDate, then by id for deterministic cursor pagination
  query = query.orderBy('transactionDate', 'desc').orderBy('id', 'desc');

  const limit = Math.min(Math.max(params.limit || 25, 1), 100);

  // Free-text search pagination semantics
  if (params.search && params.search.trim().length > 0) {
    const q = params.search.trim().toLowerCase();
    const matchedItems: TransactionDocument[] = [];
    let currentCursorSnap: FirebaseFirestore.DocumentSnapshot | null = null;

    if (params.cursor) {
      const cursorRef = col.doc(params.cursor);
      const cursorSnap = await cursorRef.get();
      if (cursorSnap.exists) {
        currentCursorSnap = cursorSnap;
      }
    }

    let hasMoreToFetch = true;
    let lastEvaluatedDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let totalScanned = 0;
    const batchSize = Math.max(limit * 2, 50);
    const maxScanLimit = 1000;

    let hasMore = false;

    while (matchedItems.length < limit && hasMoreToFetch && totalScanned < maxScanLimit) {
      let batchQuery = query.limit(batchSize + 1);
      if (currentCursorSnap) {
        batchQuery = batchQuery.startAfter(currentCursorSnap);
      }

      const batchSnap = await batchQuery.get();
      const batchDocs = batchSnap.docs;

      if (batchDocs.length === 0) {
        hasMoreToFetch = false;
        break;
      }

      const hasNextInBatch = batchDocs.length > batchSize;
      const docsToProcess = hasNextInBatch ? batchDocs.slice(0, batchSize) : batchDocs;
      totalScanned += docsToProcess.length;

      let stoppedEarlyInBatch = false;
      for (let i = 0; i < docsToProcess.length; i++) {
        const doc = docsToProcess[i];
        lastEvaluatedDoc = doc;
        const data = doc.data() as TransactionDocument;
        const desc = data.description ? data.description.toLowerCase() : '';
        const notes = data.notes ? data.notes.toLowerCase() : '';
        if (desc.includes(q) || notes.includes(q)) {
          matchedItems.push(data);
          if (matchedItems.length === limit) {
            stoppedEarlyInBatch = i < docsToProcess.length - 1;
            break;
          }
        }
      }

      if (stoppedEarlyInBatch || hasNextInBatch) {
        hasMore = true;
      } else {
        hasMore = false;
      }

      if (matchedItems.length >= limit) {
        break;
      }

      if (!hasNextInBatch) {
        hasMoreToFetch = false;
      } else {
        currentCursorSnap = lastEvaluatedDoc;
      }
    }

    const nextCursor = hasMore && lastEvaluatedDoc ? lastEvaluatedDoc.id : null;

    return {
      items: matchedItems,
      nextCursor,
      hasMore,
    };
  }

  // Standard non-search cursor query (O(limit))
  if (params.cursor) {
    const cursorRef = col.doc(params.cursor);
    const cursorSnap = await cursorRef.get();
    if (cursorSnap.exists) {
      query = query.startAfter(cursorSnap);
    }
  }

  query = query.limit(limit + 1);
  const snap = await query.get();

  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;
  const items: TransactionDocument[] = pageDocs.map((doc) => doc.data() as TransactionDocument);
  const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;

  return {
    items,
    nextCursor,
    hasMore,
  };
}
