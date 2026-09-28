import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAccount,
  updateAccount,
  getAccount,
  getAccounts,
  reconcileAccount,
  getBalanceHistory,
  validateCreateAccountInput,
  CreateAccountInput,
} from './account-service.js';
import { setFirebaseAdminForTesting } from './firebase-admin.js';

describe('Slice 2: Accounts, Cash Custody, Balances & Reconciliation', () => {
  // In-memory Firestore mock database store
  let mockStore: {
    accounts: Map<string, Record<string, unknown>>;
    snapshots: Map<string, Record<string, unknown>>;
    audit: Map<string, Record<string, unknown>>;
  };

  const USER_A = 'user-alpha-123';
  const USER_B = 'user-bravo-456';

  beforeEach(() => {
    mockStore = {
      accounts: new Map(),
      snapshots: new Map(),
      audit: new Map(),
    };

    let docIdCounter = 1;

    // Build mock Firestore database matching Admin SDK interface
    const mockDb = {
      collection: (colName: string) => {
        if (colName === 'users') {
          return {
            doc: (userId: string) => ({
              collection: (subColName: string) => {
                const getStore = () => {
                  if (subColName === 'accounts') return mockStore.accounts;
                  if (subColName === 'balanceSnapshots') return mockStore.snapshots;
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
                        const existing = getStore().get(`${userId}/${id}`);
                        if (!existing) throw new Error('Document not found');
                        getStore().set(`${userId}/${id}`, { ...existing, ...val });
                      },
                    };
                  },
                  get: async () => {
                    const docs: { data: () => Record<string, unknown> }[] = [];
                    getStore().forEach((val, key) => {
                      if (key.startsWith(`${userId}/`)) {
                        docs.push({ data: () => val });
                      }
                    });
                    return {
                      empty: docs.length === 0,
                      forEach: (cb: (doc: { data: () => Record<string, unknown> }) => void) => docs.forEach(cb),
                    };
                  },
                  where: (field: string, op: string, filterVal: unknown) => ({
                    get: async () => {
                      const docs: { data: () => Record<string, unknown> }[] = [];
                      getStore().forEach((val, key) => {
                        if (key.startsWith(`${userId}/`) && val[field] === filterVal) {
                          docs.push({ data: () => val });
                        }
                      });
                      return {
                        empty: docs.length === 0,
                        forEach: (cb: (doc: { data: () => Record<string, unknown> }) => void) => docs.forEach(cb),
                      };
                    },
                  }),
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
  });

  afterEach(() => {
    setFirebaseAdminForTesting(null);
  });

  describe('1. Input Validation & Minor Unit Standards', () => {
    it('enforces required fields and rejects invalid types', () => {
      expect(() =>
        validateCreateAccountInput({
          name: '',
          type: 'bank',
          currency: 'INR',
          openingBalance: 10000,
          openingBalanceDate: '2026-09-01',
        })
      ).toThrow('Account name is required.');

      expect(() =>
        validateCreateAccountInput({
          name: 'Checking',
          type: 'crypto' as never,
          currency: 'INR',
          openingBalance: 10000,
          openingBalanceDate: '2026-09-01',
        })
      ).toThrow("Invalid account type. Supported types for V1 are 'bank' and 'cash'.");

      expect(() =>
        validateCreateAccountInput({
          name: 'Checking',
          type: 'bank',
          currency: 'IN', // invalid currency code length
          openingBalance: 10000,
          openingBalanceDate: '2026-09-01',
        })
      ).toThrow('Currency must be a valid 3-letter ISO code');
    });

    it('strictly forbids floating-point minor units (must be integer paise)', () => {
      expect(() =>
        validateCreateAccountInput({
          name: 'Checking',
          type: 'bank',
          currency: 'INR',
          openingBalance: 1500.5, // floating point
          openingBalanceDate: '2026-09-01',
        })
      ).toThrow('Opening balance must be an integer represented in minor units');

      // Valid integer paise
      expect(() =>
        validateCreateAccountInput({
          name: 'Checking',
          type: 'bank',
          currency: 'INR',
          openingBalance: 150050,
          openingBalanceDate: '2026-09-01',
        })
      ).not.toThrow();
    });
  });

  describe('2. Account Creation & Opening Balances', () => {
    it('creates a bank account with integer opening balance and sets calculatedBalance equal to opening balance', async () => {
      const payload: CreateAccountInput = {
        name: 'HDFC Savings Account',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 2500000, // ₹25,000.00 in paise
        openingBalanceDate: '2026-09-01',
      };

      const account = await createAccount(USER_A, payload);

      expect(account.id).toBeDefined();
      expect(account.userId).toBe(USER_A);
      expect(account.name).toBe('HDFC Savings Account');
      expect(account.type).toBe('bank');
      expect(account.institution).toBe('HDFC Bank');
      expect(account.currency).toBe('INR');
      expect(account.openingBalance).toBe(2500000);
      expect(account.calculatedBalance).toBe(2500000); // Calculated balance initialized to opening balance
      expect(account.reportedBalance).toBeNull();
      expect(account.lastReconciledAt).toBeNull();
      expect(account.isActive).toBe(true);

      // Verify audit trail entry was created
      expect(mockStore.audit.size).toBe(1);
      const auditEntry = Array.from(mockStore.audit.values())[0];
      expect(auditEntry['action']).toBe('ACCOUNT_CREATED');
      expect(auditEntry['entityId']).toBe(account.id);
    });

    it('supports zero and negative opening balances (e.g. credit/overdraft) in integer units', async () => {
      const overdraft = await createAccount(USER_A, {
        name: 'Credit Line',
        type: 'bank',
        institution: 'SBI',
        currency: 'INR',
        openingBalance: -500000, // -₹5,000.00
        openingBalanceDate: '2026-09-01',
      });
      expect(overdraft.openingBalance).toBe(-500000);
      expect(overdraft.calculatedBalance).toBe(-500000);
    });
  });

  describe('3. Single Canonical Cash Account Rule', () => {
    it('permits creating a single canonical Cash account for a user', async () => {
      const cashAccount = await createAccount(USER_A, {
        name: 'Physical Cash Wallet',
        type: 'cash',
        institution: 'Cash Custody',
        currency: 'INR',
        openingBalance: 350000, // ₹3,500.00
        openingBalanceDate: '2026-09-01',
      });

      expect(cashAccount.type).toBe('cash');
      expect(cashAccount.calculatedBalance).toBe(350000);
    });

    it('strictly prevents duplicate canonical Cash accounts for the same user', async () => {
      // Create first cash account
      await createAccount(USER_A, {
        name: 'Primary Cash Drawer',
        type: 'cash',
        institution: 'Cash Custody',
        currency: 'INR',
        openingBalance: 50000,
        openingBalanceDate: '2026-09-01',
      });

      // Attempt to create a second cash account for USER_A
      await expect(
        createAccount(USER_A, {
          name: 'Secondary Cash Pocket',
          type: 'cash',
          institution: 'Cash Custody',
          currency: 'INR',
          openingBalance: 20000,
          openingBalanceDate: '2026-09-01',
        })
      ).rejects.toThrow('A canonical Cash account already exists for this user. Only one Cash account is permitted.');

      // But USER_B should be able to create their own single Cash account
      const userBCash = await createAccount(USER_B, {
        name: 'User B Cash',
        type: 'cash',
        institution: 'Cash Custody',
        currency: 'INR',
        openingBalance: 10000,
        openingBalanceDate: '2026-09-01',
      });
      expect(userBCash.userId).toBe(USER_B);
    });

    it('lists all accounts for a user with canonical Cash sorted first', async () => {
      await createAccount(USER_A, {
        name: 'Z-Bank Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 10000,
        openingBalanceDate: '2026-09-01',
      });
      await createAccount(USER_A, {
        name: 'Cash In Hand',
        type: 'cash',
        currency: 'INR',
        openingBalance: 5000,
        openingBalanceDate: '2026-09-01',
      });
      await createAccount(USER_A, {
        name: 'A-Bank Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 20000,
        openingBalanceDate: '2026-09-01',
      });

      const list = await getAccounts(USER_A);
      expect(list.length).toBe(3);
      expect(list[0].type).toBe('cash');
      expect(list[1].name).toBe('A-Bank Account');
      expect(list[2].name).toBe('Z-Bank Account');
    });
  });

  describe('4. Account Ownership Isolation', () => {
    it('denies User B from retrieving User A account', async () => {
      const accountA = await createAccount(USER_A, {
        name: 'Private Bank Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 100000,
        openingBalanceDate: '2026-09-01',
      });

      // User A can access it
      const fetched = await getAccount(USER_A, accountA.id);
      expect(fetched.id).toBe(accountA.id);

      // User B cannot access it
      await expect(getAccount(USER_B, accountA.id)).rejects.toThrow(`Account ${accountA.id} not found.`);
    });

    it('denies User B from updating User A account', async () => {
      const accountA = await createAccount(USER_A, {
        name: 'Private Bank Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 100000,
        openingBalanceDate: '2026-09-01',
      });

      await expect(
        updateAccount(USER_B, accountA.id, { name: 'Compromised Name' })
      ).rejects.toThrow(`Account ${accountA.id} not found.`);
    });
  });

  describe('5. Opening Balance Modification & Audit', () => {
    it('adjusts calculatedBalance when opening balance is updated and logs OPENING_BALANCE_CHANGED', async () => {
      const account = await createAccount(USER_A, {
        name: 'Salary Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 1000000, // 10,000 INR
        openingBalanceDate: '2026-09-01',
      });

      // Update opening balance from 10,000 INR to 12,500 INR (+2,500 INR)
      const updated = await updateAccount(USER_A, account.id, {
        openingBalance: 1250000,
      });

      expect(updated.openingBalance).toBe(1250000);
      expect(updated.calculatedBalance).toBe(1250000);

      // Verify audit logs
      const auditEntries = Array.from(mockStore.audit.values()).filter((e) => e['entityId'] === account.id);
      const openingBalanceAudit = auditEntries.find((e) => e['action'] === 'OPENING_BALANCE_CHANGED');
      expect(openingBalanceAudit).toBeDefined();
    });

    it('logs ACCOUNT_STATUS_CHANGED when account active state is toggled', async () => {
      const account = await createAccount(USER_A, {
        name: 'Old Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 0,
        openingBalanceDate: '2026-09-01',
      });

      const updated = await updateAccount(USER_A, account.id, { isActive: false });
      expect(updated.isActive).toBe(false);

      const auditEntries = Array.from(mockStore.audit.values());
      const statusAudit = auditEntries.find((e) => e['action'] === 'ACCOUNT_STATUS_CHANGED');
      expect(statusAudit).toBeDefined();
    });
  });

  describe('6. Balance Snapshots & Reconciliation Workflow', () => {
    it('creates an immutable balance snapshot and computes variance (difference = reported - calculated)', async () => {
      const account = await createAccount(USER_A, {
        name: 'Checking Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 5000000, // ₹50,000.00
        openingBalanceDate: '2026-09-01',
      });

      // Statement reported ₹50,000.00 (Zero variance)
      const resBalanced = await reconcileAccount(USER_A, account.id, {
        reportedBalance: 5000000,
        snapshotDate: '2026-09-30',
        source: 'bank_statement',
        notes: 'September closing statement',
        applyAdjustment: false,
      });

      expect(resBalanced.calculatedBalance).toBe(5000000);
      expect(resBalanced.reportedBalance).toBe(5000000);
      expect(resBalanced.difference).toBe(0);
      expect(resBalanced.adjustmentApplied).toBe(false);
      expect(resBalanced.account.reportedBalance).toBe(5000000);
      expect(resBalanced.account.lastReconciledAt).toBeDefined();

      // Check snapshot in history
      const history = await getBalanceHistory(USER_A, account.id);
      expect(history.length).toBe(1);
      expect(history[0].reportedBalance).toBe(5000000);
      expect(history[0].snapshotDate).toBe('2026-09-30');
    });

    it('does NOT modify calculated balance when difference exists and applyAdjustment is false', async () => {
      const account = await createAccount(USER_A, {
        name: 'Checking Account',
        type: 'bank',
        currency: 'INR',
        openingBalance: 5000000, // ₹50,000.00
        openingBalanceDate: '2026-09-01',
      });

      // Statement reported ₹48,500.00 (-₹1,500.00 difference)
      const res = await reconcileAccount(USER_A, account.id, {
        reportedBalance: 4850000,
        snapshotDate: '2026-10-15',
        source: 'portal',
        notes: 'Discrepancy noted under investigation',
        applyAdjustment: false,
      });

      expect(res.calculatedBalance).toBe(5000000); // Unaltered
      expect(res.reportedBalance).toBe(4850000);
      expect(res.difference).toBe(-150000);
      expect(res.adjustmentApplied).toBe(false);
      expect(res.account.calculatedBalance).toBe(5000000); // Calculated balance untouched
      expect(res.account.reportedBalance).toBe(4850000);

      // Verify audit was logged as snapshot recorded, NOT adjustment
      const auditEntries = Array.from(mockStore.audit.values());
      const snapshotAudit = auditEntries.find((e) => e['action'] === 'BALANCE_SNAPSHOT_RECORDED');
      expect(snapshotAudit).toBeDefined();
    });

    it('atomically updates calculated balance and logs RECONCILIATION_ADJUSTMENT when applyAdjustment is true', async () => {
      const account = await createAccount(USER_A, {
        name: 'Petty Cash',
        type: 'cash',
        currency: 'INR',
        openingBalance: 1000000, // ₹10,000.00
        openingBalanceDate: '2026-09-01',
      });

      // Counted cash is ₹9,800.00 (-₹200.00 variance)
      const res = await reconcileAccount(USER_A, account.id, {
        reportedBalance: 980000,
        snapshotDate: '2026-09-30',
        source: 'physical_count',
        notes: 'Cash drawer count adjustment',
        applyAdjustment: true,
      });

      expect(res.difference).toBe(-20000);
      expect(res.adjustmentApplied).toBe(true);
      expect(res.account.calculatedBalance).toBe(980000); // Adjusted to reported balance
      expect(res.account.reportedBalance).toBe(980000);

      // Verify audit was logged as RECONCILIATION_ADJUSTMENT with full detail
      const auditEntries = Array.from(mockStore.audit.values());
      const adjustAudit = auditEntries.find((e) => e['action'] === 'RECONCILIATION_ADJUSTMENT');
      expect(adjustAudit).toBeDefined();
      expect(adjustAudit!['details']).toEqual({
        previousCalculatedBalance: 1000000,
        reportedBalance: 980000,
        difference: -20000,
        snapshotId: res.snapshot.id,
        snapshotDate: '2026-09-30',
        notes: 'Cash drawer count adjustment',
      });
    });
  });
});
