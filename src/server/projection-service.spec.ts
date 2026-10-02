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

  const createQueryBuilder = (filters: MockFilter[] = []) => {
    return {
      where: (field: string, op: string, val: unknown) => {
        return createQueryBuilder([...filters, { field, op, val }]);
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
                    set: async (val: Record<string, unknown>) => {
                      projectionsStore.set(`${docUserId}/${docId}`, val);
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

  it('updates projection incrementally on creation, edit, and voiding', async () => {
    // 1. Initial build from empty ledger
    await getOrBuildProjection(userId);

    const tx: TransactionDocument = {
      id: 'tx-new',
      userId,
      accountId: 'acc-1',
      amount: 5000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-07-01',
      description: 'Freelance',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    };

    transactionsStore.set(tx.id, tx);
    await recordTransactionCreatedInProjection(userId, tx);

    let currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(5000000);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(1);

    // 2. Edit transaction: increase amount to 7,000,000
    const editedTx: TransactionDocument = {
      ...tx,
      amount: 7000000,
    };
    transactionsStore.set(editedTx.id, editedTx);
    await recordTransactionUpdatedInProjection(userId, tx, editedTx);

    currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(7000000);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(1);

    // 3. Void transaction
    const voidedTx: TransactionDocument = {
      ...editedTx,
      status: 'VOIDED',
    };
    transactionsStore.set(voidedTx.id, voidedTx);
    await recordTransactionVoidedInProjection(userId, editedTx);

    currentProj = await getOrBuildProjection(userId);
    expect(currentProj.lifetime.grossIncome).toBe(0);
    expect(currentProj.lifetime.totalPostedTransactions).toBe(0);
  });

  it('verifies projection consistency against canonical ledger', async () => {
    const tx: TransactionDocument = {
      id: 'tx-10',
      userId,
      accountId: 'acc-1',
      amount: 12000000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-08-01',
      description: 'Project Bonus',
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

    const check = await verifyProjectionConsistency(userId);
    expect(check.isConsistent).toBe(true);
    expect(check.discrepancies).toHaveLength(0);

    // Artificially corrupt stored projection to test detection
    const stored = projectionsStore.get(`${userId}/dashboard`) as unknown as {
      lifetime: { grossIncome: number };
    };
    stored.lifetime.grossIncome = 999999;
    projectionsStore.set(`${userId}/dashboard`, stored as unknown as Record<string, unknown>);

    const corruptedCheck = await verifyProjectionConsistency(userId);
    expect(corruptedCheck.isConsistent).toBe(false);
    expect(corruptedCheck.discrepancies.length).toBeGreaterThan(0);
    expect(corruptedCheck.discrepancies[0]).toContain('grossIncome mismatch');
  });
});
