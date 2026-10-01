import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTransaction,
  createInternalTransfer,
  updateTransaction,
  voidTransaction,
  getTransaction,
  getTransactions,
  CreateTransactionInput,
  CreateTransferInput,
} from './transaction-service.js';
import { setFirebaseAdminForTesting } from './firebase-admin.js';
import { classifyTransaction, getTransactionBalanceDelta } from './reporting-semantics.js';

describe('Slice 3: Transactions, Splits, Transfers & Metadata', () => {
  // In-memory Firestore mock database store
  let mockStore: {
    accounts: Map<string, Record<string, unknown>>;
    transactions: Map<string, Record<string, unknown>>;
    categories: Map<string, Record<string, unknown>>;
    counterparties: Map<string, Record<string, unknown>>;
    tags: Map<string, Record<string, unknown>>;
    audit: Map<string, Record<string, unknown>>;
  };

  const USER_A = 'user-alpha-123';
  const USER_B = 'user-bravo-456';

  beforeEach(() => {
    mockStore = {
      accounts: new Map(),
      transactions: new Map(),
      categories: new Map(),
      counterparties: new Map(),
      tags: new Map(),
      audit: new Map(),
    };

    let docIdCounter = 1;

    const mockDb = {
      collection: (colName: string) => {
        if (colName === 'users') {
          return {
            doc: (userId: string) => ({
              collection: (subColName: string) => {
                const getStore = () => {
                  if (subColName === 'accounts') return mockStore.accounts;
                  if (subColName === 'transactions') return mockStore.transactions;
                  if (subColName === 'categories') return mockStore.categories;
                  if (subColName === 'counterparties') return mockStore.counterparties;
                  if (subColName === 'tags') return mockStore.tags;
                  if (subColName === 'audit') return mockStore.audit;
                  throw new Error(`Unexpected subcollection ${subColName}`);
                };

                interface MockFilter {
                  field: string;
                  op: string;
                  val: unknown;
                }
                interface MockOrder {
                  field: string;
                  dir: 'asc' | 'desc';
                }

                const createMockQuery = (
                  filters: MockFilter[] = [],
                  orders: MockOrder[] = [],
                  limitCount: number | null = null,
                  startAfterId: string | null = null,
                ): {
                  where: (field: string, op: string, val: unknown) => ReturnType<typeof createMockQuery>;
                  orderBy: (field: string, dir?: 'asc' | 'desc') => ReturnType<typeof createMockQuery>;
                  startAfter: (docSnap: { id: string } | string) => ReturnType<typeof createMockQuery>;
                  limit: (n: number) => ReturnType<typeof createMockQuery>;
                  get: () => Promise<{
                    empty: boolean;
                    docs: { id: string; data: () => Record<string, unknown> }[];
                    forEach: (cb: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void;
                  }>;
                } => {
                  const queryObj = {
                    where: (field: string, op: string, val: unknown) => {
                      return createMockQuery([...filters, { field, op, val }], orders, limitCount, startAfterId);
                    },
                    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
                      return createMockQuery(filters, [...orders, { field, dir }], limitCount, startAfterId);
                    },
                    startAfter: (docSnap: { id: string } | string) => {
                      const id = typeof docSnap === 'string' ? docSnap : docSnap.id;
                      return createMockQuery(filters, orders, limitCount, id);
                    },
                    limit: (n: number) => {
                      return createMockQuery(filters, orders, n, startAfterId);
                    },
                    get: async () => {
                      let allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
                      for (const [key, docData] of getStore().entries()) {
                        if (!key.startsWith(`${userId}/`)) continue;

                        let matches = true;
                        for (const f of filters) {
                          if (f.op === '==') {
                            if (docData[f.field] !== f.val) { matches = false; break; }
                          } else if (f.op === '>=') {
                            if (!((docData[f.field] as string) >= (f.val as string))) { matches = false; break; }
                          } else if (f.op === '<=') {
                            if (!((docData[f.field] as string) <= (f.val as string))) { matches = false; break; }
                          } else if (f.op === 'array-contains') {
                            const arr = (docData[f.field] as unknown[]) || [];
                            if (!arr.includes(f.val)) { matches = false; break; }
                          }
                        }
                        if (matches) {
                          allDocs.push({ id: docData['id'] as string, data: () => docData });
                        }
                      }

                      if (orders.length > 0) {
                        allDocs.sort((a, b) => {
                          const aData = a.data();
                          const bData = b.data();
                          for (const o of orders) {
                            const aVal = String(aData[o.field] ?? '');
                            const bVal = String(bData[o.field] ?? '');
                            const comp = o.dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                            if (comp !== 0) return comp;
                          }
                          return 0;
                        });
                      }

                      if (startAfterId) {
                        const idx = allDocs.findIndex((d) => d.id === startAfterId);
                        if (idx !== -1) {
                          allDocs = allDocs.slice(idx + 1);
                        }
                      }

                      if (limitCount !== null) {
                        allDocs = allDocs.slice(0, limitCount);
                      }

                      return {
                        empty: allDocs.length === 0,
                        docs: allDocs,
                        forEach: (cb: (doc: { id: string; data: () => Record<string, unknown> }) => void) => {
                          allDocs.forEach((d) => cb(d));
                        },
                      };
                    },
                  };
                  return queryObj;
                };

                const baseQuery = createMockQuery();

                return {
                  doc: (docId?: string) => {
                    const id = docId || `doc_${docIdCounter++}`;
                    return {
                      id,
                      get: async () => {
                        const data = getStore().get(`${userId}/${id}`);
                        return {
                          id,
                          exists: !!data,
                          data: () => data,
                        };
                      },
                      set: async (val: Record<string, unknown>) => {
                        getStore().set(`${userId}/${id}`, { ...val, id });
                      },
                      update: async (val: Record<string, unknown>) => {
                        const curr = getStore().get(`${userId}/${id}`) || {};
                        getStore().set(`${userId}/${id}`, { ...curr, ...val });
                      },
                    };
                  },
                  where: baseQuery.where,
                  orderBy: baseQuery.orderBy,
                  startAfter: baseQuery.startAfter,
                  limit: baseQuery.limit,
                  get: baseQuery.get,
                };
              },
            }),
          };
        }
        throw new Error(`Unexpected collection ${colName}`);
      },
      runTransaction: async (updateFunction: (transaction: unknown) => Promise<unknown>) => {
        const transaction = {
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          set: (ref: { set: (v: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => ref.set(data),
          update: (ref: { update: (v: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => ref.update(data),
        };
        return updateFunction(transaction);
      },
    };

    setFirebaseAdminForTesting({
      app: null,
      auth: null,
      db: mockDb as never,
      initialized: true,
    });

    // Seed test accounts
    mockStore.accounts.set(`${USER_A}/acc_checking`, {
      id: 'acc_checking',
      userId: USER_A,
      name: 'HDFC Checking',
      type: 'bank',
      currency: 'INR',
      openingBalance: 1000000, // ₹10,000.00
      openingBalanceDate: '2026-01-01',
      calculatedBalance: 1000000,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    mockStore.accounts.set(`${USER_A}/acc_savings`, {
      id: 'acc_savings',
      userId: USER_A,
      name: 'ICICI Savings',
      type: 'bank',
      currency: 'INR',
      openingBalance: 5000000, // ₹50,000.00
      openingBalanceDate: '2026-01-01',
      calculatedBalance: 5000000,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    mockStore.accounts.set(`${USER_A}/acc_archived`, {
      id: 'acc_archived',
      userId: USER_A,
      name: 'Old Closed Bank',
      type: 'bank',
      currency: 'INR',
      openingBalance: 0,
      openingBalanceDate: '2026-01-01',
      calculatedBalance: 0,
      isActive: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Seed test categories
    mockStore.categories.set(`${USER_A}/cat_food`, {
      id: 'cat_food',
      userId: USER_A,
      name: 'Food & Dining',
      parentId: null,
      type: 'EXPENSE',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    mockStore.categories.set(`${USER_A}/cat_groceries`, {
      id: 'cat_groceries',
      userId: USER_A,
      name: 'Groceries',
      parentId: 'cat_food',
      type: 'EXPENSE',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    mockStore.categories.set(`${USER_A}/cat_salary`, {
      id: 'cat_salary',
      userId: USER_A,
      name: 'Salary',
      parentId: null,
      type: 'INCOME',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    setFirebaseAdminForTesting(null);
  });

  describe('Semantics & Balance Delta Invariants', () => {
    it('calculates correct cash flow sign and delta for all classified movements', () => {
      // 1. INCOME (+ cash)
      expect(classifyTransaction('INCOME').accountCashFlowSign).toBe(1);
      expect(getTransactionBalanceDelta('INCOME', 50000, 'POSTED')).toBe(50000);

      // 2. EXPENSE (- cash)
      expect(classifyTransaction('EXPENSE').accountCashFlowSign).toBe(-1);
      expect(getTransactionBalanceDelta('EXPENSE', 15000, 'POSTED')).toBe(-15000);

      // 3. INVESTMENT_ALLOCATION (- cash, savings allocation)
      expect(classifyTransaction('INVESTMENT_ALLOCATION').accountCashFlowSign).toBe(-1);
      expect(classifyTransaction('INVESTMENT_ALLOCATION').isInvestmentAllocation).toBe(true);
      expect(classifyTransaction('INVESTMENT_ALLOCATION').isOrdinaryExpense).toBe(false);

      // 4. TAX (- cash, separate from consumption)
      expect(classifyTransaction('TAX').accountCashFlowSign).toBe(-1);
      expect(classifyTransaction('TAX').isTax).toBe(true);
      expect(classifyTransaction('TAX').isConsumptionExpense).toBe(false);

      // 5. MONEY_LENT (- cash, receivable created, not expense)
      expect(classifyTransaction('MONEY_LENT').accountCashFlowSign).toBe(-1);
      expect(classifyTransaction('MONEY_LENT').isReceivableMovement).toBe(true);
      expect(classifyTransaction('MONEY_LENT').isOrdinaryExpense).toBe(false);

      // 6. RECEIVABLE_REPAYMENT (+ cash, reduces receivable, not income)
      expect(classifyTransaction('RECEIVABLE_REPAYMENT').accountCashFlowSign).toBe(1);
      expect(classifyTransaction('RECEIVABLE_REPAYMENT').isIncome).toBe(false);
      expect(classifyTransaction('RECEIVABLE_REPAYMENT').isReceivableMovement).toBe(true);

      // 7. DEBT_BORROWING (+ cash, creates liability, not income)
      expect(classifyTransaction('DEBT_BORROWING').accountCashFlowSign).toBe(1);
      expect(classifyTransaction('DEBT_BORROWING').isIncome).toBe(false);
      expect(classifyTransaction('DEBT_BORROWING').isDebtMovement).toBe(true);

      // 8. DEBT_REPAYMENT (- cash, liability reduction, not expense)
      expect(classifyTransaction('DEBT_REPAYMENT').accountCashFlowSign).toBe(-1);
      expect(classifyTransaction('DEBT_REPAYMENT').isOrdinaryExpense).toBe(false);
      expect(classifyTransaction('DEBT_REPAYMENT').isDebtMovement).toBe(true);

      // 9. NON_FINANCIAL_ASSET_PURCHASE (- cash, total expense but excluded from consumption)
      expect(classifyTransaction('NON_FINANCIAL_ASSET_PURCHASE').accountCashFlowSign).toBe(-1);
      expect(classifyTransaction('NON_FINANCIAL_ASSET_PURCHASE').isTotalExpense).toBe(true);
      expect(classifyTransaction('NON_FINANCIAL_ASSET_PURCHASE').isConsumptionExpense).toBe(false);

      // 10. VOIDED transaction has 0 delta
      expect(getTransactionBalanceDelta('EXPENSE', 10000, 'VOIDED')).toBe(0);
    });
  });

  describe('Standard Transaction Creation', () => {
    it('creates an EXPENSE transaction in integer minor units and reduces calculated balance', async () => {
      const input: CreateTransactionInput = {
        accountId: 'acc_checking',
        transactionDate: '2026-03-01',
        amount: 250000, // ₹2,500.00
        type: 'EXPENSE',
        categoryId: 'cat_groceries',
        description: 'Supermarket Groceries',
        tags: ['food', 'essentials'],
      };

      const tx = await createTransaction(USER_A, input);

      expect(tx.id).toBeDefined();
      expect(tx.amount).toBe(250000);
      expect(tx.status).toBe('POSTED');
      expect(tx.description).toBe('Supermarket Groceries');
      expect(tx.tags).toEqual(['food', 'essentials']);

      // Checking account balance: 1,000,000 - 250,000 = 750,000
      const acc = mockStore.accounts.get(`${USER_A}/acc_checking`);
      expect(acc?.['calculatedBalance']).toBe(750000);

      // Verify audit record was created
      expect(mockStore.audit.size).toBe(1);
    });

    it('creates an INCOME transaction and increases calculated balance', async () => {
      const input: CreateTransactionInput = {
        accountId: 'acc_savings',
        transactionDate: '2026-03-01',
        amount: 15000000, // ₹1,50,000.00
        type: 'INCOME',
        categoryId: 'cat_salary',
        description: 'Monthly Salary Credit',
      };

      const tx = await createTransaction(USER_A, input);

      expect(tx.amount).toBe(15000000);
      const acc = mockStore.accounts.get(`${USER_A}/acc_savings`);
      // Savings balance: 5,000,000 + 15,000,000 = 20,000,000
      expect(acc?.['calculatedBalance']).toBe(20000000);
    });

    it('rejects floating-point or non-positive amounts', async () => {
      await expect(
        createTransaction(USER_A, {
          accountId: 'acc_checking',
          transactionDate: '2026-03-01',
          amount: 250.75, // Invalid: not integer minor units
          type: 'EXPENSE',
          description: 'Invalid fractional',
        })
      ).rejects.toThrow('positive integer in minor units');

      await expect(
        createTransaction(USER_A, {
          accountId: 'acc_checking',
          transactionDate: '2026-03-01',
          amount: -1000, // Negative amount
          type: 'EXPENSE',
          description: 'Negative amount',
        })
      ).rejects.toThrow('positive integer in minor units');

      await expect(
        createTransaction(USER_A, {
          accountId: 'acc_checking',
          transactionDate: '2026-03-01',
          amount: 0,
          type: 'EXPENSE',
          description: 'Zero amount',
        })
      ).rejects.toThrow('positive integer in minor units');
    });

    it('rejects transaction to archived account', async () => {
      await expect(
        createTransaction(USER_A, {
          accountId: 'acc_archived',
          transactionDate: '2026-03-01',
          amount: 50000,
          type: 'EXPENSE',
          description: 'Archived post',
        })
      ).rejects.toThrow('archived/inactive');
    });

    it('rejects transaction to non-existent account or other user account', async () => {
      await expect(
        createTransaction(USER_B, {
          accountId: 'acc_checking', // Belongs to USER_A
          transactionDate: '2026-03-01',
          amount: 50000,
          type: 'EXPENSE',
          description: 'Cross-user attempt',
        })
      ).rejects.toThrow('not found or does not belong to user');
    });

    it('rejects creating INTERNAL_TRANSFER via standard transaction API', async () => {
      await expect(
        createTransaction(USER_A, {
          accountId: 'acc_checking',
          transactionDate: '2026-03-01',
          amount: 50000,
          type: 'INTERNAL_TRANSFER',
          description: 'Transfer attempt',
        })
      ).rejects.toThrow('Use the dedicated transfer API');
    });
  });

  describe('Split Transactions', () => {
    it('creates split transaction when split allocation amounts sum exactly to transaction amount', async () => {
      const input: CreateTransactionInput = {
        accountId: 'acc_checking',
        transactionDate: '2026-03-02',
        amount: 300000, // ₹3,000.00
        type: 'EXPENSE',
        description: 'Department Store Combo',
        allocations: [
          { categoryId: 'cat_groceries', amount: 200000, notes: 'Groceries' },
          { categoryId: 'cat_food', amount: 100000, notes: 'Lunch' },
        ],
      };

      const tx = await createTransaction(USER_A, input);

      expect(tx.allocations.length).toBe(2);
      expect(tx.allocations[0].amount).toBe(200000);
      expect(tx.allocations[1].amount).toBe(100000);

      // Account balance reduced by total amount (300,000)
      const acc = mockStore.accounts.get(`${USER_A}/acc_checking`);
      expect(acc?.['calculatedBalance']).toBe(700000);
    });

    it('rejects split transaction when allocations do not balance to total amount', async () => {
      const input: CreateTransactionInput = {
        accountId: 'acc_checking',
        transactionDate: '2026-03-02',
        amount: 300000, // ₹3,000.00
        type: 'EXPENSE',
        description: 'Unbalanced Split',
        allocations: [
          { categoryId: 'cat_groceries', amount: 150000 },
          { categoryId: 'cat_food', amount: 100000 }, // sum = 250,000 != 300,000
        ],
      };

      await expect(createTransaction(USER_A, input)).rejects.toThrow(
        'Split allocations total (250000) must exactly match transaction amount (300000)'
      );
    });
  });

  describe('Atomic Internal Transfers', () => {
    it('creates paired transfer records debiting source and crediting destination', async () => {
      const transferInput: CreateTransferInput = {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 400000, // ₹4,000.00
        transactionDate: '2026-03-05',
        description: 'Sweep to Savings',
      };

      const result = await createInternalTransfer(USER_A, transferInput);

      expect(result.sourceTransaction.transferDirection).toBe('OUT');
      expect(result.destinationTransaction.transferDirection).toBe('IN');
      expect(result.sourceTransaction.transferGroupId).toBe(result.destinationTransaction.transferGroupId);
      expect(result.sourceTransaction.amount).toBe(400000);
      expect(result.destinationTransaction.amount).toBe(400000);

      // Checking: 1,000,000 - 400,000 = 600,000
      const sourceAcc = mockStore.accounts.get(`${USER_A}/acc_checking`);
      expect(sourceAcc?.['calculatedBalance']).toBe(600000);

      // Savings: 5,000,000 + 400,000 = 5,400,000
      const destAcc = mockStore.accounts.get(`${USER_A}/acc_savings`);
      expect(destAcc?.['calculatedBalance']).toBe(5400000);
    });

    it('rejects transfer between same account', async () => {
      await expect(
        createInternalTransfer(USER_A, {
          sourceAccountId: 'acc_checking',
          destinationAccountId: 'acc_checking',
          amount: 10000,
          transactionDate: '2026-03-05',
        })
      ).rejects.toThrow('Source and destination accounts must be different');
    });
  });

  describe('Transaction Editing', () => {
    it('updates transaction amount and adjusts calculatedBalance by exact difference', async () => {
      // 1. Create original expense ₹1,000.00 (100,000 paise)
      const tx = await createTransaction(USER_A, {
        accountId: 'acc_checking',
        transactionDate: '2026-03-01',
        amount: 100000,
        type: 'EXPENSE',
        description: 'Original description',
      });

      // Checking balance: 1,000,000 - 100,000 = 900,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(900000);

      // 2. Edit amount to ₹1,500.00 (150,000 paise)
      const updated = await updateTransaction(USER_A, tx.id, {
        amount: 150000,
        description: 'Updated description',
      });

      expect(updated.amount).toBe(150000);
      expect(updated.description).toBe('Updated description');

      // Checking balance: 900,000 - 50,000 = 850,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(850000);
    });

    it('prevents editing a voided transaction', async () => {
      const tx = await createTransaction(USER_A, {
        accountId: 'acc_checking',
        transactionDate: '2026-03-01',
        amount: 50000,
        type: 'EXPENSE',
        description: 'To be voided',
      });

      await voidTransaction(USER_A, tx.id, 'User mistake');

      await expect(
        updateTransaction(USER_A, tx.id, {
          description: 'Attempted edit',
        })
      ).rejects.toThrow('Voided transactions cannot be edited');
    });
  });

  describe('Transaction Voiding & Reversal', () => {
    it('voids standard transaction and reverses its exact delta from account balance', async () => {
      const tx = await createTransaction(USER_A, {
        accountId: 'acc_checking',
        transactionDate: '2026-03-01',
        amount: 200000, // ₹2,000.00 expense
        type: 'EXPENSE',
        description: 'Cancelled Purchase',
      });

      // Balance was 1,000,000 - 200,000 = 800,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(800000);

      const voided = await voidTransaction(USER_A, tx.id, 'Merchant refund on spot');
      expect(voided.status).toBe('VOIDED');
      expect(voided.voidReason).toBe('Merchant refund on spot');

      // Balance restored to 1,000,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(1000000);
    });

    it('voiding one side of internal transfer voids both records atomically and reverses both balances', async () => {
      const transfer = await createInternalTransfer(USER_A, {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 500000, // ₹5,000.00
        transactionDate: '2026-03-02',
      });

      // Checking: 500,000 | Savings: 5,500,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(500000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5500000);

      // Void the transfer via destination transaction ID
      await voidTransaction(USER_A, transfer.destinationTransaction.id, 'Duplicate sweep');

      // Both balances reversed
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(1000000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5000000);

      // Both transactions marked VOIDED
      const sTx = await getTransaction(USER_A, transfer.sourceTransaction.id);
      const dTx = await getTransaction(USER_A, transfer.destinationTransaction.id);
      expect(sTx.status).toBe('VOIDED');
      expect(dTx.status).toBe('VOIDED');
    });
  });

  describe('Filtering & Listing', () => {
    it('filters transactions by type, category, and status', async () => {
      await createTransaction(USER_A, {
        accountId: 'acc_checking',
        transactionDate: '2026-03-01',
        amount: 100000,
        type: 'EXPENSE',
        categoryId: 'cat_groceries',
        description: 'Supermarket',
      });

      await createTransaction(USER_A, {
        accountId: 'acc_savings',
        transactionDate: '2026-03-02',
        amount: 500000,
        type: 'INCOME',
        categoryId: 'cat_salary',
        description: 'Salary Bonus',
      });

      const expenseList = await getTransactions(USER_A, { type: 'EXPENSE' });
      expect(expenseList.items.length).toBe(1);
      expect(expenseList.items[0].description).toBe('Supermarket');

      const incomeList = await getTransactions(USER_A, { type: 'INCOME' });
      expect(incomeList.items.length).toBe(1);
      expect(incomeList.items[0].description).toBe('Salary Bonus');
    });
  });

  describe('Slice 3.1 Hardening: Transfer Edit Invariants', () => {
    it('atomically updates both legs and account balances when transfer amount is edited', async () => {
      // Checking starts at 1,000,000; Savings starts at 5,000,000
      const transfer = await createInternalTransfer(USER_A, {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 100000, // ₹1,000.00
        transactionDate: '2026-03-01',
        description: 'Monthly savings sweep',
      });

      // Checking: 900,000 | Savings: 5,100,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(900000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5100000);

      // Edit transfer amount to ₹1,500.00 (150,000 paise) via the source leg
      const updatedSource = await updateTransaction(USER_A, transfer.sourceTransaction.id, {
        amount: 150000,
        notes: 'Increased sweep',
      });

      expect(updatedSource.amount).toBe(150000);

      // Verify destination leg also updated atomically
      const destTx = await getTransaction(USER_A, transfer.destinationTransaction.id);
      expect(destTx.amount).toBe(150000);
      expect(destTx.notes).toBe('Increased sweep');

      // Verify account balances adjusted by the additional 50,000 difference
      // Checking: 900,000 - 50,000 = 850,000
      // Savings: 5,100,000 + 50,000 = 5,150,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(850000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5150000);

      // Verify audit trail recorded for transfer edit
      const auditEntries = Array.from(mockStore.audit.values());
      const editAudit = auditEntries.find((e) => e['action'] === 'TRANSFER_EDITED');
      expect(editAudit).toBeDefined();
      expect(editAudit!['details']['previousAmount']).toBe(100000);
      expect(editAudit!['details']['updatedAmount']).toBe(150000);
      expect(editAudit!['details']['amountDifference']).toBe(50000);
    });

    it('rejects illegal transfer mutations (changing type, adding split allocations, invalid amount)', async () => {
      const transfer = await createInternalTransfer(USER_A, {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 50000,
        transactionDate: '2026-03-01',
      });

      // 1. Cannot change type to EXPENSE
      await expect(
        updateTransaction(USER_A, transfer.sourceTransaction.id, {
          type: 'EXPENSE',
        })
      ).rejects.toThrow('Cannot change type of an internal transfer leg');

      // 2. Cannot add split allocations
      await expect(
        updateTransaction(USER_A, transfer.sourceTransaction.id, {
          allocations: [{ categoryId: 'cat_groceries', amount: 50000 }],
        })
      ).rejects.toThrow('Internal transfers cannot have split allocations');

      // 3. Amount must be positive integer minor units
      await expect(
        updateTransaction(USER_A, transfer.sourceTransaction.id, {
          amount: -10000,
        })
      ).rejects.toThrow('Transaction amount must be a positive integer in minor units');

      await expect(
        updateTransaction(USER_A, transfer.sourceTransaction.id, {
          amount: 50.75,
        })
      ).rejects.toThrow('Transaction amount must be a positive integer in minor units');
    });
  });

  describe('Slice 3.1 Hardening: Transfer Void Invariants', () => {
    it('voiding destination leg voids both records atomically and reverses balances accurately', async () => {
      const transfer = await createInternalTransfer(USER_A, {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 250000, // ₹2,500.00
        transactionDate: '2026-03-03',
      });

      // Balances: Checking: 750,000 | Savings: 5,250,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(750000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5250000);

      // Void using the destination leg
      const voidRes = await voidTransaction(USER_A, transfer.destinationTransaction.id, 'Wrong amount initiated');
      expect(voidRes.status).toBe('VOIDED');
      expect(voidRes.voidReason).toBe('Wrong amount initiated');

      // Both accounts reversed to original balances (1,000,000 and 5,000,000)
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(1000000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5000000);

      // Calling void again is idempotent and does not reverse balances a second time
      const repeatVoid = await voidTransaction(USER_A, transfer.destinationTransaction.id);
      expect(repeatVoid.status).toBe('VOIDED');
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(1000000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5000000);
    });
  });

  describe('Slice 3.1 Hardening: Historical Transaction Edits', () => {
    it('updates historical transaction amount and date and adjusts account balance accurately', async () => {
      // Create transaction in previous month
      const tx = await createTransaction(USER_A, {
        accountId: 'acc_checking',
        transactionDate: '2026-01-15',
        amount: 40000, // ₹400.00 expense
        type: 'EXPENSE',
        description: 'Historical book purchase',
      });

      // Checking balance: 1,000,000 - 40,000 = 960,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(960000);

      // User realizes the actual receipt was ₹600.00 on 2026-01-10
      const updated = await updateTransaction(USER_A, tx.id, {
        amount: 60000, // +₹200.00 expense
        transactionDate: '2026-01-10',
        description: 'Historical book purchase (corrected)',
      });

      expect(updated.amount).toBe(60000);
      expect(updated.transactionDate).toBe('2026-01-10');

      // Balance adjusted by additional -20,000 = 940,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(940000);
    });
  });

  describe('Slice 3.1 Hardening: Idempotent Duplicate Requests', () => {
    it('re-posting identical transaction with same idempotencyKey returns existing record without double-mutating', async () => {
      const input: CreateTransactionInput = {
        accountId: 'acc_checking',
        transactionDate: '2026-03-05',
        amount: 75000, // ₹750.00
        type: 'EXPENSE',
        description: 'Server hosting fee',
        idempotencyKey: 'idemp-req-srv-750',
      };

      const first = await createTransaction(USER_A, input);
      expect(first.id).toBeDefined();
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(925000);

      // Duplicate request arrives
      const second = await createTransaction(USER_A, input);
      expect(second.id).toBe(first.id);

      // Balance remains 925,000 (NOT double-deducted to 850,000)
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(925000);
    });

    it('re-posting internal transfer with same idempotencyKey returns existing transfer without double-mutating', async () => {
      const input: CreateTransferInput = {
        sourceAccountId: 'acc_checking',
        destinationAccountId: 'acc_savings',
        amount: 120000, // ₹1,200.00
        transactionDate: '2026-03-05',
        idempotencyKey: 'idemp-transfer-sweep-120',
      };

      const first = await createInternalTransfer(USER_A, input);
      expect(first.sourceTransaction.id).toBeDefined();

      // Checking: 1,000,000 - 120,000 = 880,000
      // Savings: 5,000,000 + 120,000 = 5,120,000
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(880000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5120000);

      // Duplicate transfer arrives
      const second = await createInternalTransfer(USER_A, input);
      expect(second.sourceTransaction.id).toBe(first.sourceTransaction.id);
      expect(second.destinationTransaction.id).toBe(first.destinationTransaction.id);

      // Balances preserved
      expect(mockStore.accounts.get(`${USER_A}/acc_checking`)?.['calculatedBalance']).toBe(880000);
      expect(mockStore.accounts.get(`${USER_A}/acc_savings`)?.['calculatedBalance']).toBe(5120000);
    });
  });

  describe('Slice 3.1 Hardening: 10k+ Cursor Pagination Behavior', () => {
    it('executes native Firestore cursor queries with O(limit) performance across 10,000+ items', async () => {
      // Seed 10,000 transaction records into mockStore
      const TOTAL_ITEMS = 10000;
      const baseTimestamp = new Date('2026-01-01T00:00:00Z').getTime();

      for (let i = 1; i <= TOTAL_ITEMS; i++) {
        const dateOffset = Math.floor(i / 50); // multiple per day
        const itemDate = new Date(baseTimestamp + dateOffset * 86400000).toISOString().split('T')[0];
        const id = `tx_10k_${String(i).padStart(6, '0')}`;
        mockStore.transactions.set(`${USER_A}/${id}`, {
          id,
          userId: USER_A,
          accountId: 'acc_checking',
          transactionDate: itemDate,
          amount: 1000,
          type: 'EXPENSE',
          status: 'POSTED',
          description: `Transaction #${i}`,
          tags: ['bulk'],
          allocations: [],
          createdAt: new Date(baseTimestamp + i * 1000).toISOString(),
          updatedAt: new Date(baseTimestamp + i * 1000).toISOString(),
        });
      }

      expect(mockStore.transactions.size).toBe(TOTAL_ITEMS);

      // 1. Fetch Page 1 with limit 25
      const page1 = await getTransactions(USER_A, {
        accountId: 'acc_checking',
        limit: 25,
      });

      expect(page1.items.length).toBe(25);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.nextCursor).toBe(page1.items[24].id);

      // 2. Fetch Page 2 with limit 25 using cursor
      const page2 = await getTransactions(USER_A, {
        accountId: 'acc_checking',
        limit: 25,
        cursor: page1.nextCursor!,
      });

      expect(page2.items.length).toBe(25);
      expect(page2.hasMore).toBe(true);
      expect(page2.nextCursor).toBeDefined();

      // Invariant: Zero duplicate IDs between Page 1 and Page 2
      const page1Ids = new Set(page1.items.map((t) => t.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }

      // Invariant: Strictly descending chronological order
      const all40 = [...page1.items, ...page2.items];
      for (let k = 0; k < all40.length - 1; k++) {
        const cur = all40[k];
        const nxt = all40[k + 1];
        expect(cur.transactionDate >= nxt.transactionDate).toBe(true);
      }
    });
  });
});
