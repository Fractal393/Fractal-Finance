import { getFirebaseAdmin } from './firebase-admin.js';
import { createAuditRecord } from './audit-service.js';
import type { TransactionDocument } from './transaction-service.js';
import { getTransactionBalanceDelta } from './reporting-semantics.js';

export type AccountType = 'bank' | 'cash';

export interface AccountDocument {
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

export interface BalanceSnapshotDocument {
  id: string;
  userId: string;
  accountId: string;
  snapshotDate: string; // ISO date (YYYY-MM-DD)
  reportedBalance: number; // Integer minor units
  source: string;
  notes?: string;
  createdAt: string;
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  institution?: string;
  currency: string;
  openingBalance: number; // Integer minor units
  openingBalanceDate: string; // ISO date
}

export interface UpdateAccountInput {
  name?: string;
  institution?: string;
  currency?: string;
  openingBalance?: number;
  openingBalanceDate?: string;
  isActive?: boolean;
}

export interface ReconcileAccountInput {
  reportedBalance: number; // Integer minor units
  snapshotDate: string;
  source?: string;
  notes?: string;
  applyAdjustment?: boolean;
}

export interface ReconcileResult {
  account: AccountDocument;
  snapshot: BalanceSnapshotDocument;
  calculatedBalance: number;
  reportedBalance: number;
  difference: number;
  adjustmentApplied: boolean;
  adjustmentTransaction?: TransactionDocument | null;
}

function validateISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const parsed = new Date(dateStr);
  return !isNaN(parsed.getTime());
}

/**
 * Validates account creation payload according to strict project specifications.
 */
export function validateCreateAccountInput(input: CreateAccountInput): void {
  if (!input) {
    throw new Error('Request payload is required.');
  }

  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Account name is required.');
  }
  if (input.name.trim().length > 100) {
    throw new Error('Account name cannot exceed 100 characters.');
  }

  const normalizedType = input.type?.toLowerCase();
  if (normalizedType !== 'bank' && normalizedType !== 'cash') {
    throw new Error("Invalid account type. Supported types for V1 are 'bank' and 'cash'.");
  }

  if (input.institution && typeof input.institution !== 'string') {
    throw new Error('Institution must be a valid text string.');
  }
  if (input.institution && input.institution.trim().length > 100) {
    throw new Error('Institution cannot exceed 100 characters.');
  }

  if (!input.currency || typeof input.currency !== 'string') {
    throw new Error('Currency is required.');
  }
  const normalizedCurrency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw new Error('Currency must be a valid 3-letter ISO code (e.g., INR, USD, EUR).');
  }

  if (input.openingBalance === undefined || input.openingBalance === null) {
    throw new Error('Opening balance is required.');
  }
  if (typeof input.openingBalance !== 'number' || !Number.isInteger(input.openingBalance)) {
    throw new Error('Opening balance must be an integer represented in minor units (e.g., paise).');
  }

  if (!input.openingBalanceDate || !validateISODate(input.openingBalanceDate)) {
    throw new Error('Valid opening balance date is required (YYYY-MM-DD).');
  }
}

/**
 * Creates an account for the authenticated user.
 * Enforces single canonical Cash account rule and generates an audit log.
 */
export async function createAccount(
  userId: string,
  input: CreateAccountInput,
): Promise<AccountDocument> {
  validateCreateAccountInput(input);

  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const normalizedType = input.type.toLowerCase() as AccountType;
  const normalizedCurrency = input.currency.trim().toUpperCase();
  const normalizedName = input.name.trim();
  const institution = (input.institution?.trim() || (normalizedType === 'cash' ? 'Cash Custody' : 'Bank')).slice(0, 100);

  const accountsCol = db.collection('users').doc(userId).collection('accounts');

  // Enforce single canonical Cash account rule
  if (normalizedType === 'cash') {
    const existingCashSnap = await accountsCol.where('type', '==', 'cash').get();
    if (!existingCashSnap.empty) {
      const err = new Error('A canonical Cash account already exists for this user. Only one Cash account is permitted.');
      (err as unknown as { code: string }).code = 'DUPLICATE_CASH_ACCOUNT';
      throw err;
    }
  }

  const accountRef = accountsCol.doc();
  const now = new Date().toISOString();

  const newAccount: AccountDocument = {
    id: accountRef.id,
    userId,
    name: normalizedName,
    type: normalizedType,
    institution,
    currency: normalizedCurrency,
    openingBalance: input.openingBalance,
    openingBalanceDate: input.openingBalanceDate.split('T')[0],
    calculatedBalance: input.openingBalance,
    reportedBalance: null,
    lastReconciledAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await accountRef.set(newAccount);

  // Generate audit record
  await createAuditRecord({
    userId,
    actor: userId,
    action: 'ACCOUNT_CREATED',
    entityType: 'account',
    entityId: newAccount.id,
    details: {
      name: newAccount.name,
      type: newAccount.type,
      currency: newAccount.currency,
      openingBalance: newAccount.openingBalance,
      openingBalanceDate: newAccount.openingBalanceDate,
    },
  });

  return newAccount;
}

/**
 * Updates an existing account with ownership checks and audit recording.
 */
export async function updateAccount(
  userId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<AccountDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(accountId);
  const snap = await accountRef.get();

  if (!snap.exists) {
    const err = new Error(`Account ${accountId} not found.`);
    (err as unknown as { code: string }).code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as AccountDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied. Account does not belong to the user.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  const updates: Partial<AccountDocument> = {
    updatedAt: new Date().toISOString(),
  };

  const auditDetails: Record<string, unknown> = {
    accountId,
    previous: {},
    updated: {},
  };

  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 100) {
      throw new Error('Account name must be between 1 and 100 characters.');
    }
    updates.name = trimmedName;
    (auditDetails['previous'] as Record<string, unknown>)['name'] = current.name;
    (auditDetails['updated'] as Record<string, unknown>)['name'] = trimmedName;
  }

  if (input.institution !== undefined) {
    const trimmedInst = input.institution.trim();
    if (trimmedInst.length > 100) {
      throw new Error('Institution cannot exceed 100 characters.');
    }
    updates.institution = trimmedInst;
    (auditDetails['previous'] as Record<string, unknown>)['institution'] = current.institution;
    (auditDetails['updated'] as Record<string, unknown>)['institution'] = trimmedInst;
  }

  if (input.currency !== undefined) {
    const normalizedCurrency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      throw new Error('Currency must be a valid 3-letter ISO code.');
    }
    updates.currency = normalizedCurrency;
    (auditDetails['previous'] as Record<string, unknown>)['currency'] = current.currency;
    (auditDetails['updated'] as Record<string, unknown>)['currency'] = normalizedCurrency;
  }

  let openingBalanceChanged = false;
  if (input.openingBalance !== undefined) {
    if (typeof input.openingBalance !== 'number' || !Number.isInteger(input.openingBalance)) {
      throw new Error('Opening balance must be an integer represented in minor units.');
    }
    const balanceDiff = input.openingBalance - current.openingBalance;
    updates.openingBalance = input.openingBalance;
    updates.calculatedBalance = current.calculatedBalance + balanceDiff;
    openingBalanceChanged = true;

    (auditDetails['previous'] as Record<string, unknown>)['openingBalance'] = current.openingBalance;
    (auditDetails['updated'] as Record<string, unknown>)['openingBalance'] = input.openingBalance;
    (auditDetails['updated'] as Record<string, unknown>)['calculatedBalance'] = updates.calculatedBalance;
  }

  if (input.openingBalanceDate !== undefined) {
    if (!validateISODate(input.openingBalanceDate)) {
      throw new Error('Valid opening balance date is required (YYYY-MM-DD).');
    }
    updates.openingBalanceDate = input.openingBalanceDate.split('T')[0];
    (auditDetails['previous'] as Record<string, unknown>)['openingBalanceDate'] = current.openingBalanceDate;
    (auditDetails['updated'] as Record<string, unknown>)['openingBalanceDate'] = updates.openingBalanceDate;
  }

  let statusChanged = false;
  if (input.isActive !== undefined && typeof input.isActive === 'boolean') {
    if (input.isActive !== current.isActive) {
      updates.isActive = input.isActive;
      statusChanged = true;
      (auditDetails['previous'] as Record<string, unknown>)['isActive'] = current.isActive;
      (auditDetails['updated'] as Record<string, unknown>)['isActive'] = input.isActive;
    }
  }

  await accountRef.update(updates);
  const updatedAccount: AccountDocument = {
    ...current,
    ...updates,
  };

  if (statusChanged) {
    await createAuditRecord({
      userId,
      actor: userId,
      action: 'ACCOUNT_STATUS_CHANGED',
      entityType: 'account',
      entityId: accountId,
      details: auditDetails,
    });
  }

  if (openingBalanceChanged) {
    await createAuditRecord({
      userId,
      actor: userId,
      action: 'OPENING_BALANCE_CHANGED',
      entityType: 'account',
      entityId: accountId,
      details: auditDetails,
    });
  }

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'ACCOUNT_EDITED',
    entityType: 'account',
    entityId: accountId,
    details: auditDetails,
  });

  return updatedAccount;
}

/**
 * Retrieves all accounts for an authenticated user.
 */
export async function getAccounts(userId: string): Promise<AccountDocument[]> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const snap = await db.collection('users').doc(userId).collection('accounts').get();
  const accounts: AccountDocument[] = [];

  snap.forEach((doc) => {
    accounts.push(doc.data() as AccountDocument);
  });

  // Sort canonical Cash account first, then bank accounts alphabetically by name
  return accounts.sort((a, b) => {
    if (a.type === 'cash' && b.type !== 'cash') return -1;
    if (b.type === 'cash' && a.type !== 'cash') return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Retrieves a single account for an authenticated user with ownership verification.
 */
export async function getAccount(userId: string, accountId: string): Promise<AccountDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const snap = await db.collection('users').doc(userId).collection('accounts').doc(accountId).get();
  if (!snap.exists) {
    const err = new Error(`Account ${accountId} not found.`);
    (err as unknown as { code: string }).code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  const account = snap.data() as AccountDocument;
  if (account.userId !== userId) {
    const err = new Error('Access denied. Account does not belong to the user.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  return account;
}

/**
 * Reconciles an account against an external reported balance snapshot.
 * Creates an immutable snapshot document and an audit record.
 * If applyAdjustment is requested, atomically updates the calculated balance.
 */
export async function reconcileAccount(
  userId: string,
  accountId: string,
  input: ReconcileAccountInput,
): Promise<ReconcileResult> {
  if (input.reportedBalance === undefined || input.reportedBalance === null) {
    throw new Error('Reported balance is required for reconciliation.');
  }
  if (typeof input.reportedBalance !== 'number' || !Number.isInteger(input.reportedBalance)) {
    throw new Error('Reported balance must be an integer minor units (e.g., paise).');
  }
  if (!input.snapshotDate || !validateISODate(input.snapshotDate)) {
    throw new Error('Valid snapshot date is required (YYYY-MM-DD).');
  }

  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(accountId);
  const snapshotsCol = db.collection('users').doc(userId).collection('balanceSnapshots');
  const snapshotRef = snapshotsCol.doc();

  const now = new Date().toISOString();
  const applyAdjustment = input.applyAdjustment === true;

  return await db.runTransaction(async (transaction) => {
    const accountSnap = await transaction.get(accountRef);
    if (!accountSnap.exists) {
      const err = new Error(`Account ${accountId} not found.`);
      (err as unknown as { code: string }).code = 'ACCOUNT_NOT_FOUND';
      throw err;
    }

    const account = accountSnap.data() as AccountDocument;
    if (account.userId !== userId) {
      const err = new Error('Access denied. Account does not belong to the user.');
      (err as unknown as { code: string }).code = 'ACCESS_DENIED';
      throw err;
    }

    const currentCalculated = account.calculatedBalance;
    const difference = input.reportedBalance - currentCalculated;

    const snapshot: BalanceSnapshotDocument = {
      id: snapshotRef.id,
      userId,
      accountId,
      snapshotDate: input.snapshotDate.split('T')[0],
      reportedBalance: input.reportedBalance,
      source: input.source?.trim() || 'manual',
      notes: input.notes?.trim() || '',
      createdAt: now,
    };

    transaction.set(snapshotRef, snapshot);

    const accountUpdates: Partial<AccountDocument> = {
      reportedBalance: input.reportedBalance,
      lastReconciledAt: now,
      updatedAt: now,
    };

    let adjustmentTx: TransactionDocument | null = null;
    if (applyAdjustment && difference !== 0) {
      const txCol = db.collection('users').doc(userId).collection('transactions');
      const txRef = txCol.doc();
      const isPositive = difference > 0;
      const desc = input.notes?.trim() || `Reconciliation adjustment (${isPositive ? '+' : ''}${difference / 100})`;

      adjustmentTx = {
        id: txRef.id,
        userId,
        accountId,
        transactionDate: input.snapshotDate.split('T')[0],
        amount: Math.abs(difference),
        type: 'RECONCILIATION_ADJUSTMENT',
        reconciliationDiscrepancy: difference,
        reconciliationId: snapshotRef.id,
        categoryId: null,
        counterpartyId: null,
        description: desc,
        tags: ['reconciliation'],
        notes: `System-generated reconciliation adjustment against reported balance ${input.reportedBalance} (delta: ${difference > 0 ? '+' : ''}${difference})`,
        status: 'POSTED',
        transferGroupId: null,
        allocations: [],
        createdAt: now,
        updatedAt: now,
      };

      transaction.set(txRef, adjustmentTx);
      accountUpdates.calculatedBalance = currentCalculated + difference;
    }

    transaction.update(accountRef, accountUpdates);

    const updatedAccount: AccountDocument = {
      ...account,
      ...accountUpdates,
    };

    return {
      account: updatedAccount,
      snapshot,
      calculatedBalance: currentCalculated,
      reportedBalance: input.reportedBalance,
      difference,
      adjustmentApplied: applyAdjustment && difference !== 0,
      adjustmentTransaction: adjustmentTx,
    };
  }).then(async (result) => {
    // Audit after atomic transaction commit
    if (result.adjustmentApplied) {
      await createAuditRecord({
        userId,
        actor: userId,
        action: 'RECONCILIATION_ADJUSTMENT',
        entityType: 'account',
        entityId: accountId,
        details: {
          previousCalculatedBalance: result.calculatedBalance,
          reportedBalance: result.reportedBalance,
          difference: result.difference,
          snapshotId: result.snapshot.id,
          snapshotDate: result.snapshot.snapshotDate,
          adjustmentTransactionId: result.adjustmentTransaction?.id || null,
          notes: result.snapshot.notes,
        },
      });
    } else {
      await createAuditRecord({
        userId,
        actor: userId,
        action: 'BALANCE_SNAPSHOT_RECORDED',
        entityType: 'balanceSnapshot',
        entityId: result.snapshot.id,
        details: {
          accountId,
          calculatedBalance: result.calculatedBalance,
          reportedBalance: result.reportedBalance,
          difference: result.difference,
          snapshotDate: result.snapshot.snapshotDate,
          notes: result.snapshot.notes,
        },
      });
    }

    return result;
  });
}

/**
 * Retrieves reported balance snapshot history for a given account.
 */
export async function getBalanceHistory(
  userId: string,
  accountId: string,
): Promise<BalanceSnapshotDocument[]> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  // Verify account belongs to user first
  await getAccount(userId, accountId);

  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('balanceSnapshots')
    .where('accountId', '==', accountId)
    .get();

  const snapshots: BalanceSnapshotDocument[] = [];
  snap.forEach((doc) => {
    snapshots.push(doc.data() as BalanceSnapshotDocument);
  });

  return snapshots.sort((a, b) => {
    // Sort descending by snapshotDate, then by createdAt
    const dateComp = b.snapshotDate.localeCompare(a.snapshotDate);
    if (dateComp !== 0) return dateComp;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Normalizes and derives account calculated balance strictly around the ledger.
 * Sums: account.openingBalance + sum(all POSTED transactions for this account).
 * If there is any discrepancy, updates account.calculatedBalance.
 */
export async function recalculateAccountBalanceFromLedger(
  userId: string,
  accountId: string,
): Promise<{ account: AccountDocument; derivedBalance: number; previousCalculatedBalance: number }> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const accountRef = db.collection('users').doc(userId).collection('accounts').doc(accountId);
  const snap = await accountRef.get();
  if (!snap.exists) {
    const err = new Error(`Account ${accountId} not found.`);
    (err as unknown as { code: string }).code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  const account = snap.data() as AccountDocument;
  if (account.userId !== userId) {
    const err = new Error('Access denied to account.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  // Fetch all transactions for this account
  const txSnap = await db
    .collection('users')
    .doc(userId)
    .collection('transactions')
    .where('accountId', '==', accountId)
    .get();

  let ledgerSum = 0;
  txSnap.forEach((doc) => {
    const tx = doc.data() as TransactionDocument;
    if (tx.status === 'POSTED') {
      ledgerSum += getTransactionBalanceDelta(
        tx.type,
        tx.amount,
        tx.status,
        tx.transferDirection,
        tx.reconciliationDiscrepancy,
      );
    }
  });

  const derivedBalance = account.openingBalance + ledgerSum;
  const previousCalculatedBalance = account.calculatedBalance;

  if (derivedBalance !== previousCalculatedBalance) {
    const now = new Date().toISOString();
    await accountRef.update({
      calculatedBalance: derivedBalance,
      updatedAt: now,
    });
    account.calculatedBalance = derivedBalance;
    account.updatedAt = now;

    await createAuditRecord({
      userId,
      actor: userId,
      action: 'ACCOUNT_BALANCE_RECALCULATED',
      entityType: 'account',
      entityId: accountId,
      details: {
        previousCalculatedBalance,
        derivedBalance,
        ledgerTransactionsCount: txSnap.docs.length,
      },
    });
  }

  return {
    account,
    derivedBalance,
    previousCalculatedBalance,
  };
}
