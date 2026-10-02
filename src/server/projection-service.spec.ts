import { describe, it, expect, beforeEach } from 'vitest';
import { setFirebaseAdminForTesting } from './firebase-admin.js';
import {
  createEmptyProjection,
  applyTransactionToProjectionData,
  rebuildProjectionFromLedger,
  getOrBuildProjection,
  recordTransactionCreatedInProjection,
  recordTransactionVoidedInProjection,
  recordTransactionUpdatedInProjection,
  recordInternalTransferCreatedInProjection,
  recordTransactionsVoidedInProjection,
  markProjectionStale,
  verifyProjectionConsistency,
} from './projection-service.js';
import type { TransactionDocument } from './transaction-service.js';

describe('Projection Service & Rebuildable Derived Projections', () => {
  const userId = 'user-proj-123';
  let transactionsStore: Map<string, TransactionDocument>;
  let projectionsStore: Map<string, Record<string, unknown>>;

  interface MockFilter {
    field: string;
    op: string;
    val: unknown;
  }

  interface MockOrder {
    field: string;
    dir: 'asc' | 'desc';
  }

  const createQueryBuilder = (
    filters: MockFilter[] = [],
    orderBys: MockOrder[] = [],
    limitVal?: number,
  ) => {
    return {
      where: (field: string, op: string, val: unknown) => {
        return createQueryBuilder([...filters, { field, op, val }], orderBys, limitVal);
      },
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
        return createQueryBuilder(filters, [...orderBys, { field, dir }], limitVal);
      },
      limit: (n: number) => {
        return createQueryBuilder(filters, orderBys, n);
      },
      get: async () => {
        let docs = Array.from(transactionsStore.values()).filter((t) => t.userId === userId);
        for (const f of filters) {
          docs = docs.filter((t) => {
            const val = (t as unknown as Record<string, unknown>)[f.field];
            if (f.op === '==') return val === f.val;
            if (f.op === '>=') return (val as string) >= (f.val as string);
            if (f.op === '<=') return (val as string) <= (f.val as string);
            if (f.op === '>') return (val as string) > (f.val as string);
            if (f.op === '<') return (val as string) < (f.val as string);
            return true;
          });
        }
        if (orderBys.length > 0) {
          docs.sort((a, b) => {
            for (const o of orderBys) {
              const aVal = String((a as unknown as Record<string, unknown>)[o.field] ?? '');
              const bVal = String((b as unknown as Record<string, unknown>)[o.field] ?? '');
              const comp = o.dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
              if (comp !== 0) return comp;
            }
            return 0;
          });
        }
        if (limitVal !== undefined) {
          docs = docs.slice(0, limitVal);
        }
        return {
          empty: docs.length === 0,
          docs: docs.map((d) => ({ id: d.id, data: () => d })),
        };
      },
    };
  };

  beforeEach(() => {
    transactionsStore = new Map();
    projectionsStore = new Map();

    const mockDb = {
      collection: (colName: string) => {
        if (colName !== 'users') throw new Error(`Unexpected collection ${colName}`);
        return {
          doc: (docUserId: string) => ({
            collection: (subCol: string) => {
              if (subCol === 'transactions') {
                return createQueryBuilder();
              }
              if (subCol === 'projections') {
                return {
                  doc: (docId: string) => ({
                    get: async () => {
                      const data = projectionsStore.get(`${docUserId}/${docId}`);
                      return {
                        exists: !!data,
                        data: () => data,
                      };
                    },
                    set: async (val: Record<string, unknown>, opts?: { merge?: boolean }) => {
                      if (opts?.merge) {
                        const existing = projectionsStore.get(`${docUserId}/${docId}`) || {};
                        projectionsStore.set(`${docUserId}/${docId}`, { ...existing, ...val });
                      } else {
                        projectionsStore.set(`${docUserId}/${docId}`, val);
                      }
                    },
                    update: async (val: Record<string, unknown>) => {
                      const existing = projectionsStore.get(`${docUserId}/${docId}`) || {};
                      projectionsStore.set(`${docUserId}/${docId}`, { ...existing, ...val });
                    },
                  }),
                };
              }
              return {
                get: async () => ({ empty: true, docs: [] }),
              };
            },
          }),
        };
      },
      runTransaction: async (updateFunction: (transaction: unknown) => Promise<unknown>) => {
        const transaction = {
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          set: (ref: { set: (v: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>, opts?: Record<string, unknown>) => ref.set(data, opts),
          update: (ref: { update: (v: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => ref.update(data),
        };
        return updateFunction(transaction);
      },
    };

    setFirebaseAdminForTesting({
      db: mockDb as unknown as FirebaseFirestore.Firestore,
      auth: null,
      app: null,
      initialized: true,
    });
  });

  it('creates an empty projection with zero balances and liabilities', () => {
    const proj = createEmptyProjection(userId);
    expect(proj.userId).toBe(userId);
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.lifetime.consumptionExpenses).toBe(0);
    expect(proj.lifetime.totalPostedTransactions).toBe(0);
    expect(proj.debt.cumulativeDebtBorrowing).toBe(0);
    expect(proj.debt.cumulativeDebtRepayment).toBe(0);
    expect(proj.debt.outstandingDebtLiability).toBe(0);
    expect(Object.keys(proj.monthlySummaries)).toHaveLength(0);
  });

  it('applies transactions to projection data correctly', () => {
    const proj = createEmptyProjection(userId);

    const txIncome: TransactionDocument = {
      id: 'tx-1',
      userId,
      accountId: 'acc-1',
      amount: 10000000, // ₹1,00,000
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-05-10',
      description: 'Consulting Income',
      tags: [],
      notes: '',
      categoryId: 'cat-inc',
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-05-10T00:00:00Z',
      updatedAt: '2026-05-10T00:00:00Z',
    };

    applyTransactionToProjectionData(proj, txIncome, 1);
    expect(proj.lifetime.grossIncome).toBe(10000000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);
    expect(proj.lifetime.earliestTransactionDate).toBe('2026-05-10');
    expect(proj.monthlySummaries['2026-05'].grossIncome).toBe(10000000);

    const txDebtBorrow: TransactionDocument = {
      id: 'tx-2',
      userId,
      accountId: 'acc-1',
      amount: 5000000, // ₹50,000
      type: 'DEBT_BORROWING',
      status: 'POSTED',
      transactionDate: '2026-05-15',
      description: 'Personal Loan',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
    };

    applyTransactionToProjectionData(proj, txDebtBorrow, 1);
    expect(proj.debt.cumulativeDebtBorrowing).toBe(5000000);
    expect(proj.debt.outstandingDebtLiability).toBe(5000000);

    const txDebtRepay: TransactionDocument = {
      id: 'tx-3',
      userId,
      accountId: 'acc-1',
      amount: 2000000, // ₹20,000
      type: 'DEBT_REPAYMENT',
      status: 'POSTED',
      transactionDate: '2026-06-15',
      description: 'Loan Repayment EMI',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-06-15T00:00:00Z',
      updatedAt: '2026-06-15T00:00:00Z',
    };

    applyTransactionToProjectionData(proj, txDebtRepay, 1);
    expect(proj.debt.cumulativeDebtRepayment).toBe(2000000);
    expect(proj.debt.outstandingDebtLiability).toBe(3000000); // 50,000 - 20,000 = ₹30,000
  });

  it('rebuilds projection deterministically from canonical ledger', async () => {
    transactionsStore.set('tx-1', {
      id: 'tx-1',
      userId,
      accountId: 'acc-1',
      amount: 8000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-04-10',
      description: 'Salary',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-04-10T00:00:00Z',
      updatedAt: '2026-04-10T00:00:00Z',
    });

    transactionsStore.set('tx-2', {
      id: 'tx-2',
      userId,
      accountId: 'acc-1',
      amount: 1500000,
      type: 'TAX',
      status: 'POSTED',
      transactionDate: '2026-04-15',
      description: 'TDS',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-04-15T00:00:00Z',
      updatedAt: '2026-04-15T00:00:00Z',
    });

    transactionsStore.set('tx-3', {
      id: 'tx-3',
      userId,
      accountId: 'acc-1',
      amount: 2500000,
      type: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-04-20',
      description: 'Rent',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-04-20T00:00:00Z',
      updatedAt: '2026-04-20T00:00:00Z',
    });

    // Voided transaction should be excluded
    transactionsStore.set('tx-void', {
      id: 'tx-void',
      userId,
      accountId: 'acc-1',
      amount: 5000000,
      type: 'EXPENSE',
      status: 'VOIDED',
      transactionDate: '2026-04-22',
      description: 'Mistake transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-04-22T00:00:00Z',
      updatedAt: '2026-04-22T00:00:00Z',
    });

    const projection = await rebuildProjectionFromLedger(userId);

    expect(projection.lifetime.grossIncome).toBe(8000000);
    expect(projection.lifetime.netTaxPaid).toBe(1500000);
    expect(projection.lifetime.consumptionExpenses).toBe(2500000);
    expect(projection.lifetime.totalPostedTransactions).toBe(3);
    expect(projection.lifetime.earliestTransactionDate).toBe('2026-04-10');

    // Stored in projections collection
    expect(projectionsStore.has(`${userId}/dashboard`)).toBe(true);
  });

  it('updates projection incrementally and idempotently on repeated creation calls', async () => {
    await getOrBuildProjection(userId);

    const tx: TransactionDocument = {
      id: 'tx-idem',
      userId,
      accountId: 'acc-1',
      amount: 4000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-07-01',
      description: 'Consulting',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    };

    transactionsStore.set(tx.id, tx);

    // Call 1
    await recordTransactionCreatedInProjection(userId, tx);
    let currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(4000000);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(1);

    // Call 2 (repeated call with identical state - must be idempotent no-op)
    await recordTransactionCreatedInProjection(userId, tx);
    currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(4000000);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(1);

    // Call 3
    await recordTransactionCreatedInProjection(userId, tx);
    currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(4000000);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(1);
  });

  it('handles concurrent projection updates without losing data', async () => {
    await getOrBuildProjection(userId);

    const tx1: TransactionDocument = {
      id: 'tx-c1',
      userId,
      accountId: 'acc-1',
      amount: 1000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-07-02',
      description: 'Income A',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    const tx2: TransactionDocument = {
      id: 'tx-c2',
      userId,
      accountId: 'acc-1',
      amount: 2000000,
      type: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-07-03',
      description: 'Expense B',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-03T00:00:00Z',
      updatedAt: '2026-07-03T00:00:00Z',
    };

    transactionsStore.set(tx1.id, tx1);
    transactionsStore.set(tx2.id, tx2);

    // Concurrently trigger projection updates
    await Promise.all([
      recordTransactionCreatedInProjection(userId, tx1),
      recordTransactionCreatedInProjection(userId, tx2),
    ]);

    const proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(1000000);
    expect(proj.lifetime.consumptionExpenses).toBe(2000000);
    expect(proj.lifetime.totalPostedTransactions).toBe(2);
  });

  it('records paired internal transfers consistently and idempotently', async () => {
    await getOrBuildProjection(userId);

    const sourceTx: TransactionDocument = {
      id: 'tx-src',
      userId,
      accountId: 'acc-1',
      amount: 5000000,
      type: 'INTERNAL_TRANSFER',
      transferDirection: 'OUTGOING',
      transferGroupId: 'grp-1',
      status: 'POSTED',
      transactionDate: '2026-07-05',
      description: 'Transfer Out',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-05T00:00:00Z',
      updatedAt: '2026-07-05T00:00:00Z',
    };

    const destTx: TransactionDocument = {
      id: 'tx-dest',
      userId,
      accountId: 'acc-2',
      amount: 5000000,
      type: 'INTERNAL_TRANSFER',
      transferDirection: 'INCOMING',
      transferGroupId: 'grp-1',
      status: 'POSTED',
      transactionDate: '2026-07-05',
      description: 'Transfer In',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-05T00:00:00Z',
      updatedAt: '2026-07-05T00:00:00Z',
    };

    transactionsStore.set(sourceTx.id, sourceTx);
    transactionsStore.set(destTx.id, destTx);

    // Apply paired legs
    await recordInternalTransferCreatedInProjection(userId, sourceTx, destTx);

    let proj = await getOrBuildProjection(userId);
    // Transfers do not affect personal income or expenses
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.lifetime.consumptionExpenses).toBe(0);
    expect(proj.lifetime.totalPostedTransactions).toBe(2);

    // Retrying paired transfer update is idempotent
    await recordInternalTransferCreatedInProjection(userId, sourceTx, destTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.totalPostedTransactions).toBe(2);

    // Voiding transfer legs atomically
    await recordTransactionsVoidedInProjection(userId, [sourceTx, destTx]);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.totalPostedTransactions).toBe(0);
  });

  it('handles edits that change transaction date, type, and amount', async () => {
    await getOrBuildProjection(userId);

    const originalTx: TransactionDocument = {
      id: 'tx-edit-test',
      userId,
      accountId: 'acc-1',
      amount: 3000000, // ₹30,000 EXPENSE in March
      type: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      description: 'Business Expense',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-03-10T00:00:00Z',
      updatedAt: '2026-03-10T00:00:00Z',
    };

    transactionsStore.set(originalTx.id, originalTx);
    await recordTransactionCreatedInProjection(userId, originalTx);

    let proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.consumptionExpenses).toBe(3000000);
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.monthlySummaries['2026-03'].consumptionExpenses).toBe(3000000);

    // Edit: change to INCOME of ₹50,000 in April
    const editedTx: TransactionDocument = {
      ...originalTx,
      amount: 5000000,
      type: 'INCOME',
      transactionDate: '2026-04-12',
      updatedAt: '2026-04-12T00:00:00Z',
    };

    transactionsStore.set(editedTx.id, editedTx);
    await recordTransactionUpdatedInProjection(userId, originalTx, editedTx);

    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.consumptionExpenses).toBe(0);
    expect(proj.lifetime.grossIncome).toBe(5000000);
    expect(proj.monthlySummaries['2026-03'].consumptionExpenses).toBe(0);
    expect(proj.monthlySummaries['2026-04'].grossIncome).toBe(5000000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);

    // Repeating the same edit update is idempotent
    await recordTransactionUpdatedInProjection(userId, originalTx, editedTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(5000000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);
  });

  it('updates earliestTransactionDate when the earliest transaction is voided', async () => {
    await getOrBuildProjection(userId);

    const tx1: TransactionDocument = {
      id: 'tx-earliest-1',
      userId,
      accountId: 'acc-1',
      amount: 1000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2025-01-10',
      description: 'Earliest Transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2025-01-10T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
    };

    const tx2: TransactionDocument = {
      id: 'tx-earliest-2',
      userId,
      accountId: 'acc-1',
      amount: 2000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2025-06-20',
      description: 'Later Transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2025-06-20T00:00:00Z',
      updatedAt: '2025-06-20T00:00:00Z',
    };

    transactionsStore.set(tx1.id, tx1);
    transactionsStore.set(tx2.id, tx2);

    await recordTransactionCreatedInProjection(userId, tx1);
    await recordTransactionCreatedInProjection(userId, tx2);

    let proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.earliestTransactionDate).toBe('2025-01-10');

    // Void tx1 (the earliest transaction)
    const voidedTx1: TransactionDocument = {
      ...tx1,
      status: 'VOIDED',
      updatedAt: '2025-06-25T00:00:00Z',
    };
    transactionsStore.set(tx1.id, voidedTx1);

    await recordTransactionVoidedInProjection(userId, tx1);

    proj = await getOrBuildProjection(userId);
    // Earliest transaction date must advance to tx2's date
    expect(proj.lifetime.earliestTransactionDate).toBe('2025-06-20');

    // Void tx2
    const voidedTx2: TransactionDocument = {
      ...tx2,
      status: 'VOIDED',
      updatedAt: '2025-06-26T00:00:00Z',
    };
    transactionsStore.set(tx2.id, voidedTx2);

    await recordTransactionVoidedInProjection(userId, tx2);

    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.earliestTransactionDate).toBeNull();
  });

  it('updates earliestTransactionDate when the earliest transaction date is edited forward', async () => {
    await getOrBuildProjection(userId);

    const tx1: TransactionDocument = {
      id: 'tx-shift-1',
      userId,
      accountId: 'acc-1',
      amount: 1000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2025-02-01',
      description: 'First',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2025-02-01T00:00:00Z',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    const tx2: TransactionDocument = {
      id: 'tx-shift-2',
      userId,
      accountId: 'acc-1',
      amount: 1000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2025-05-15',
      description: 'Second',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2025-05-15T00:00:00Z',
      updatedAt: '2025-05-15T00:00:00Z',
    };

    transactionsStore.set(tx1.id, tx1);
    transactionsStore.set(tx2.id, tx2);

    await recordTransactionCreatedInProjection(userId, tx1);
    await recordTransactionCreatedInProjection(userId, tx2);

    let proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.earliestTransactionDate).toBe('2025-02-01');

    // Edit tx1: move date to 2025-08-01 (after tx2)
    const shiftedTx1: TransactionDocument = {
      ...tx1,
      transactionDate: '2025-08-01',
      updatedAt: '2025-08-01T00:00:00Z',
    };
    transactionsStore.set(tx1.id, shiftedTx1);

    await recordTransactionUpdatedInProjection(userId, tx1, shiftedTx1);

    proj = await getOrBuildProjection(userId);
    // tx2 is now the earliest
    expect(proj.lifetime.earliestTransactionDate).toBe('2025-05-15');
  });

  it('marks projection stale on error and triggers automatic repair on dashboard retrieval', async () => {
    // 1. Initial clean ledger
    const tx: TransactionDocument = {
      id: 'tx-repair-1',
      userId,
      accountId: 'acc-1',
      amount: 7500000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-08-01',
      description: 'Retainer',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    transactionsStore.set(tx.id, tx);
    await rebuildProjectionFromLedger(userId);

    let proj = await getOrBuildProjection(userId);
    expect(proj.isStale).toBe(false);
    expect(proj.lifetime.grossIncome).toBe(7500000);

    // 2. Simulate failed maintenance: mark projection as stale
    await markProjectionStale(userId, 'PROJECTION_MAINTENANCE_TIMEOUT');

    const rawStored = projectionsStore.get(`${userId}/dashboard`) as unknown as {
      isStale: boolean;
      staleReason: string;
    };
    expect(rawStored.isStale).toBe(true);
    expect(rawStored.staleReason).toBe('PROJECTION_MAINTENANCE_TIMEOUT');

    // Add another transaction directly to ledger while marked stale
    const tx2: TransactionDocument = {
      id: 'tx-repair-2',
      userId,
      accountId: 'acc-1',
      amount: 2500000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-08-05',
      description: 'Second Retainer',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
    };
    transactionsStore.set(tx2.id, tx2);

    // 3. Dashboard retrieval automatically detects stale projection and triggers repair rebuild
    proj = await getOrBuildProjection(userId);
    expect(proj.isStale).toBe(false);
    expect(proj.lifetime.grossIncome).toBe(10000000); // 7,500,000 + 2,500,000
    expect(proj.lifetime.totalPostedTransactions).toBe(2);
  });

  it('performs comprehensive consistency verification across all lifetime, debt, and monthly fields', async () => {
    const tx: TransactionDocument = {
      id: 'tx-comp-check',
      userId,
      accountId: 'acc-1',
      amount: 15000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-08-01',
      description: 'Annual Contract',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };

    transactionsStore.set(tx.id, tx);
    await rebuildProjectionFromLedger(userId);

    // 1. Clean verification
    const cleanCheck = await verifyProjectionConsistency(userId);
    expect(cleanCheck.isConsistent).toBe(true);
    expect(cleanCheck.discrepancies).toHaveLength(0);

    // 2. Corrupt a monthly field specifically
    const stored = JSON.parse(JSON.stringify(projectionsStore.get(`${userId}/dashboard`)));
    stored.monthlySummaries['2026-08'].netTaxPaid = 50000;
    projectionsStore.set(`${userId}/dashboard`, stored);

    let check = await verifyProjectionConsistency(userId);
    expect(check.isConsistent).toBe(false);
    expect(check.discrepancies.some((d) => d.includes('monthlySummaries[2026-08].netTaxPaid'))).toBe(true);

    // 3. Corrupt a debt liability field specifically
    const stored2 = JSON.parse(JSON.stringify(cleanCheck.storedProjection));
    stored2.debt.outstandingDebtLiability = 999999;
    projectionsStore.set(`${userId}/dashboard`, stored2);

    check = await verifyProjectionConsistency(userId);
    expect(check.isConsistent).toBe(false);
    expect(check.discrepancies.some((d) => d.includes('debt.outstandingDebtLiability'))).toBe(true);

    // 4. Corrupt lifetime reconciliationAdjustments
    const stored3 = JSON.parse(JSON.stringify(cleanCheck.storedProjection));
    stored3.lifetime.reconciliationAdjustments = 12345;
    projectionsStore.set(`${userId}/dashboard`, stored3);

    check = await verifyProjectionConsistency(userId);
    expect(check.isConsistent).toBe(false);
    expect(check.discrepancies.some((d) => d.includes('lifetime.reconciliationAdjustments'))).toBe(true);
  });
});
