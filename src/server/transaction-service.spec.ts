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

                return {
                  doc: (docId?: string) => {
                    const id = docId || `doc_${docIdCounter++}`;
                    return {
                      id,
                      get: async () => {
                        const data = getStore().get(`${userId}/${id}`);
                        return {
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
                  where: (field: string, op: string, val: unknown) => {
                    return {
                      limit: (n: number) => ({
                        get: async () => {
                          const allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
                          for (const [key, docData] of getStore().entries()) {
                            if (key.startsWith(`${userId}/`) && docData[field] === val) {
                              allDocs.push({
                                id: docData['id'] as string,
                                data: () => docData,
                              });
                              if (allDocs.length >= n) break;
                            }
                          }
                          return {
                            empty: allDocs.length === 0,
                            docs: allDocs,
                          };
                        },
                      }),
                      get: async () => {
                        const allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
                        for (const [key, docData] of getStore().entries()) {
                          if (key.startsWith(`${userId}/`) && docData[field] === val) {
                            allDocs.push({
                              id: docData['id'] as string,
                              data: () => docData,
                            });
                          }
                        }
                        return {
                          empty: allDocs.length === 0,
                          docs: allDocs,
                        };
                      },
                    };
                  },
                  get: async () => {
                    const allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
                    for (const [key, docData] of getStore().entries()) {
                      if (key.startsWith(`${userId}/`)) {
                        allDocs.push({
                          id: docData['id'] as string,
                          data: () => docData,
                        });
                      }
                    }
                    return {
                      empty: allDocs.length === 0,
                      forEach: (cb: (doc: { data: () => Record<string, unknown> }) => void) => {
                        allDocs.forEach((d) => cb(d));
                      },
                      docs: allDocs,
                    };
                  },
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
});
