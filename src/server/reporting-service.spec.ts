import { describe, it, expect, beforeEach } from 'vitest';
import { setFirebaseAdminForTesting } from './firebase-admin.js';
import {
  resolveReportingPeriod,
  formatPrettyDate,
  getDashboardReport,
} from './reporting-service.js';
import type { AccountDocument } from './account-service.js';
import type { TransactionDocument, CategoryDocument } from './transaction-service.js';

describe('Reporting Service & Period Semantics', () => {
  describe('formatPrettyDate', () => {
    it('formats ISO dates into MMM D, YYYY without timezone shift', () => {
      expect(formatPrettyDate('2026-04-01')).toBe('Apr 1, 2026');
      expect(formatPrettyDate('2027-03-31')).toBe('Mar 31, 2027');
      expect(formatPrettyDate('2026-10-15')).toBe('Oct 15, 2026');
      expect(formatPrettyDate('2026-01-05')).toBe('Jan 5, 2026');
    });
  });

  describe('resolveReportingPeriod', () => {
    it('resolves Current Month correctly', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('current_month', undefined, undefined, refDate);
      expect(range.period).toBe('current_month');
      expect(range.startDate).toBe('2026-10-01');
      expect(range.endDate).toBe('2026-10-31');
      expect(range.label).toBe('Current Month · Oct 1, 2026 – Oct 31, 2026');
    });

    it('resolves Financial Year (Apr 1 - Mar 31) for a date in October 2026', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('financial_year', undefined, undefined, refDate, 4);
      expect(range.period).toBe('financial_year');
      expect(range.startDate).toBe('2026-04-01');
      expect(range.endDate).toBe('2027-03-31');
      expect(range.label).toBe('Financial Year · Apr 1, 2026 – Mar 31, 2027');
    });

    it('resolves Financial Year (Apr 1 - Mar 31) for a date in February 2027', () => {
      const refDate = new Date(2027, 1, 10); // Feb 10, 2027
      const range = resolveReportingPeriod('financial_year', undefined, undefined, refDate, 4);
      expect(range.period).toBe('financial_year');
      expect(range.startDate).toBe('2026-04-01');
      expect(range.endDate).toBe('2027-03-31');
      expect(range.label).toBe('Financial Year · Apr 1, 2026 – Mar 31, 2027');
    });

    it('resolves Last 12 Months correctly', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('last_12_months', undefined, undefined, refDate);
      expect(range.period).toBe('last_12_months');
      expect(range.startDate).toBe('2025-11-01');
      expect(range.endDate).toBe('2026-10-31');
      expect(range.label).toBe('Last 12 Months · Nov 1, 2025 – Oct 31, 2026');
    });

    it('resolves All History correctly', () => {
      const range = resolveReportingPeriod('all_history');
      expect(range.period).toBe('all_history');
      expect(range.startDate).toBe('1970-01-01');
      expect(range.endDate).toBe('9999-12-31');
      expect(range.label).toBe('All History · Lifetime Activity');
    });

    it('resolves Custom Range correctly when valid dates are passed', () => {
      const range = resolveReportingPeriod('custom', '2026-06-01', '2026-08-31');
      expect(range.period).toBe('custom');
      expect(range.startDate).toBe('2026-06-01');
      expect(range.endDate).toBe('2026-08-31');
      expect(range.label).toBe('Custom Range · Jun 1, 2026 – Aug 31, 2026');
    });
  });

  describe('getDashboardReport with canonical mock data', () => {
    const userId = 'user-dashboard-1';

    let accountsStore: Map<string, AccountDocument>;
    let categoriesStore: Map<string, CategoryDocument>;
    let transactionsStore: Map<string, TransactionDocument>;

    beforeEach(() => {
      accountsStore = new Map();
      categoriesStore = new Map();
      transactionsStore = new Map();

      const mockDb = {
        collection: (colName: string) => {
          if (colName !== 'users') throw new Error(`Unexpected collection ${colName}`);
          return {
            doc: (docUserId: string) => {
              return {
                collection: (subCol: string) => {
                  return {
                    get: async () => {
                      if (subCol === 'accounts') {
                        const docs = Array.from(accountsStore.values())
                          .filter((a) => a.userId === docUserId)
                          .map((a) => ({ id: a.id, data: () => a }));
                        return { empty: docs.length === 0, docs };
                      }
                      if (subCol === 'categories') {
                        const docs = Array.from(categoriesStore.values())
                          .filter((c) => c.userId === docUserId)
                          .map((c) => ({ id: c.id, data: () => c }));
                        return { empty: docs.length === 0, docs };
                      }
                      if (subCol === 'transactions') {
                        const docs = Array.from(transactionsStore.values())
                          .filter((t) => t.userId === docUserId)
                          .map((t) => ({ id: t.id, data: () => t }));
                        return { empty: docs.length === 0, docs };
                      }
                      return { empty: true, docs: [] };
                    },
                  };
                },
              };
            },
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

    it('computes empty financial state without errors', async () => {
      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 1),
      });

      expect(report.netWorth.cashPosition).toBe(0);
      expect(report.netWorth.totalNetWorth).toBe(0);
      expect(report.netWorth.disclaimer).toBe('Based on available financial data');
      expect(report.periodMetrics.grossIncome).toBe(0);
      expect(report.periodMetrics.totalExpenses).toBe(0);
      expect(report.periodMetrics.savings).toBe(0);
      expect(report.periodMetrics.savingsRate).toBeNull();
      expect(report.cashFlow.internalTransferNetImpact).toBe(0);
      expect(report.composition.accounts).toHaveLength(0);
    });

    it('calculates Cash Position strictly from active bank and cash accounts', async () => {
      accountsStore.set('acc-1', {
        id: 'acc-1',
        userId,
        name: 'HDFC Savings',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01',
        calculatedBalance: 25000000, // ₹2,50,000
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      accountsStore.set('acc-2', {
        id: 'acc-2',
        userId,
        name: 'Physical Wallet',
        type: 'cash',
        institution: 'Cash',
        currency: 'INR',
        openingBalance: 5000,
        openingBalanceDate: '2026-01-01',
        calculatedBalance: 1200000, // ₹12,000
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      accountsStore.set('acc-archived', {
        id: 'acc-archived',
        userId,
        name: 'Old Closed Account',
        type: 'bank',
        institution: 'Old Bank',
        currency: 'INR',
        openingBalance: 0,
        openingBalanceDate: '2025-01-01',
        calculatedBalance: 500000,
        isActive: false, // Inactive account must be excluded
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 1),
      });

      expect(report.netWorth.cashPosition).toBe(26200000); // 25,00,000 + 12,000 = ₹2,62,000
      expect(report.composition.bankAccountsTotal).toBe(25000000);
      expect(report.composition.cashAccountsTotal).toBe(1200000);
      expect(report.composition.accounts).toHaveLength(2);
      expect(report.composition.untrackedClasses.length).toBeGreaterThanOrEqual(3);
    });

    it('correctly calculates Income, Net Tax Paid, Consumption Expenses, Total Expenses, Savings, and Savings Rate', async () => {
      categoriesStore.set('cat-groceries', {
        id: 'cat-groceries',
        userId,
        name: 'Groceries',
        parentId: null,
        type: 'EXPENSE',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      categoriesStore.set('cat-salary', {
        id: 'cat-salary',
        userId,
        name: 'Salary',
        parentId: null,
        type: 'INCOME',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // Transactions for Oct 2026
      // 1. Income: ₹1,00,000 (10,000,000 paise)
      transactionsStore.set('tx-inc', {
        id: 'tx-inc',
        userId,
        accountId: 'acc-1',
        amount: 10000000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-10-01',
        description: 'Monthly Salary',
        categoryId: 'cat-salary',
        allocations: [],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      // 2. Net Tax Paid: ₹10,000 (1,000,000 paise)
      transactionsStore.set('tx-tax', {
        id: 'tx-tax',
        userId,
        accountId: 'acc-1',
        amount: 1000000,
        type: 'TAX',
        status: 'POSTED',
        transactionDate: '2026-10-02',
        description: 'Advance Tax / TDS',
        allocations: [],
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      });

      // 3. Consumption Expense: ₹25,000 (2,500,000 paise)
      transactionsStore.set('tx-exp', {
        id: 'tx-exp',
        userId,
        accountId: 'acc-1',
        amount: 2500000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        description: 'Supermarket Groceries',
        categoryId: 'cat-groceries',
        allocations: [],
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      });

      // 4. Non-Financial Asset Purchase: ₹5,000 (500,000 paise) (in Total Expenses, NOT Consumption Expenses)
      transactionsStore.set('tx-asset', {
        id: 'tx-asset',
        userId,
        accountId: 'acc-1',
        amount: 500000,
        type: 'NON_FINANCIAL_ASSET_PURCHASE',
        status: 'POSTED',
        transactionDate: '2026-10-10',
        description: 'Office Chair',
        allocations: [],
        createdAt: '2026-10-10T00:00:00Z',
        updatedAt: '2026-10-10T00:00:00Z',
      });

      // 5. Investment Allocation: ₹20,000 (2,000,000 paise) (MUST NOT be subtracted from Savings)
      transactionsStore.set('tx-inv', {
        id: 'tx-inv',
        userId,
        accountId: 'acc-1',
        amount: 2000000,
        type: 'INVESTMENT_ALLOCATION',
        status: 'POSTED',
        transactionDate: '2026-10-12',
        description: 'Index Fund SIP',
        allocations: [],
        createdAt: '2026-10-12T00:00:00Z',
        updatedAt: '2026-10-12T00:00:00Z',
      });

      // 6. Voided transaction: Should be ignored
      transactionsStore.set('tx-voided', {
        id: 'tx-voided',
        userId,
        accountId: 'acc-1',
        amount: 999999,
        type: 'EXPENSE',
        status: 'VOIDED',
        transactionDate: '2026-10-15',
        description: 'Mistaken duplicate',
        allocations: [],
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
      });

      // 7. Transaction from 6 months ago (outside current month period)
      transactionsStore.set('tx-old', {
        id: 'tx-old',
        userId,
        accountId: 'acc-1',
        amount: 5000000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-04-10',
        description: 'Old April Salary',
        allocations: [],
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 20), // Oct 2026
      });

      // Calculations:
      // Gross Income = 10,000,000 paise (₹1,00,000)
      expect(report.periodMetrics.grossIncome).toBe(10000000);

      // Net Tax Paid = 1,000,000 paise (₹10,000)
      expect(report.periodMetrics.netTaxPaid).toBe(1000000);

      // Net Income = 10,000,000 - 1,000,000 = 9,000,000 paise (₹90,000)
      expect(report.periodMetrics.netIncome).toBe(9000000);

      // Consumption Expenses = 2,500,000 paise (₹25,000)
      expect(report.periodMetrics.consumptionExpenses).toBe(2500000);

      // Non-financial Asset Purchases = 500,000 paise (₹5,000)
      expect(report.periodMetrics.nonFinancialAssetPurchases).toBe(500000);

      // Total Expenses = 2,500,000 + 500,000 = 3,000,000 paise (₹30,000)
      expect(report.periodMetrics.totalExpenses).toBe(3000000);

      // Savings = Net Income - Total Expenses = 9,000,000 - 3,000,000 = 6,000,000 paise (₹60,000)
      expect(report.periodMetrics.savings).toBe(6000000);

      // Savings Rate = 60,000 / 90,000 = 66.7%
      expect(report.periodMetrics.savingsRate).toBe(66.7);

      // Investment Allocation = 2,000,000 paise (₹20,000)
      // Must NOT be subtracted from Savings!
      expect(report.periodMetrics.investmentAllocation).toBe(2000000);
      expect(report.periodMetrics.cashRetained).toBe(4000000); // 60,000 - 20,000 = ₹40,000

      // Lifetime Summary must include the April transaction as well!
      // Lifetime Income = 10,000,000 (Oct) + 5,000,000 (Apr) = 15,000,000
      expect(report.lifetimeSummary.lifetimeGrossIncome).toBe(15000000);
      expect(report.lifetimeSummary.lifetimeTotalExpenses).toBe(3000000);
      expect(report.lifetimeSummary.totalPostedTransactions).toBe(6);
    });

    it('ensures internal transfers net to 0 personal cash flow movement', async () => {
      // Transfer ₹15,000 from Bank to Wallet
      transactionsStore.set('tx-tr-out', {
        id: 'tx-tr-out',
        userId,
        accountId: 'acc-1',
        amount: 1500000,
        type: 'INTERNAL_TRANSFER',
        transferDirection: 'OUT',
        status: 'POSTED',
        transactionDate: '2026-10-08',
        description: 'ATM Cash Withdrawal',
        allocations: [],
        createdAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
      });
      transactionsStore.set('tx-tr-in', {
        id: 'tx-tr-in',
        userId,
        accountId: 'acc-2',
        amount: 1500000,
        type: 'INTERNAL_TRANSFER',
        transferDirection: 'IN',
        status: 'POSTED',
        transactionDate: '2026-10-08',
        description: 'ATM Cash Deposit into Wallet',
        allocations: [],
        createdAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 15),
      });

      // Internal transfer does NOT count as income or expense
      expect(report.periodMetrics.grossIncome).toBe(0);
      expect(report.periodMetrics.totalExpenses).toBe(0);
      expect(report.cashFlow.internalTransferVolume).toBe(1500000);
      expect(report.cashFlow.internalTransferNetImpact).toBe(0);
    });

    it('correctly aggregates split transaction allocations by category', async () => {
      categoriesStore.set('cat-food', {
        id: 'cat-food',
        userId,
        name: 'Dining & Groceries',
        parentId: null,
        type: 'EXPENSE',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      categoriesStore.set('cat-utils', {
        id: 'cat-utils',
        userId,
        name: 'Household Utilities',
        parentId: null,
        type: 'EXPENSE',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // Split transaction of ₹10,000: ₹6,000 food + ₹4,000 utils
      transactionsStore.set('tx-split', {
        id: 'tx-split',
        userId,
        accountId: 'acc-1',
        amount: 1000000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-09',
        description: 'Departmental store bulk buy',
        allocations: [
          { categoryId: 'cat-food', amount: 600000, notes: 'Food portion' },
          { categoryId: 'cat-utils', amount: 400000, notes: 'Cleaning materials' },
        ],
        createdAt: '2026-10-09T00:00:00Z',
        updatedAt: '2026-10-09T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 15),
      });

      expect(report.categoryBreakdown).toHaveLength(2);
      const foodItem = report.categoryBreakdown.find((c) => c.categoryId === 'cat-food');
      const utilsItem = report.categoryBreakdown.find((c) => c.categoryId === 'cat-utils');

      expect(foodItem?.amount).toBe(600000);
      expect(foodItem?.percentage).toBe(60.0);
      expect(utilsItem?.amount).toBe(400000);
      expect(utilsItem?.percentage).toBe(40.0);
    });

    it('displays undefined savings rate as null when net income is zero or negative', async () => {
      // Expense of ₹5,000 with 0 Income
      transactionsStore.set('tx-loss', {
        id: 'tx-loss',
        userId,
        accountId: 'acc-1',
        amount: 500000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        description: 'Subscription',
        allocations: [],
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 15),
      });

      expect(report.periodMetrics.grossIncome).toBe(0);
      expect(report.periodMetrics.netIncome).toBe(0);
      expect(report.periodMetrics.savings).toBe(-500000);
      expect(report.periodMetrics.savingsRate).toBeNull();
      expect(report.financialHealth.savingsRate.value).toBeNull();
      expect(report.financialHealth.savingsRate.formatted).toBe('—');
    });
  });
});
