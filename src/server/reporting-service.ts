import { getFirebaseAdmin } from './firebase-admin.js';
import type { AccountDocument } from './account-service.js';
import type { TransactionDocument } from './transaction-service.js';
import type { CategoryDocument } from './metadata-service.js';
import { getTransactionBalanceDelta } from './reporting-semantics.js';

export type ReportingPeriodType =
  | 'current_month'
  | 'financial_year'
  | 'last_12_months'
  | 'all_history'
  | 'custom';

export const VALID_PERIOD_TYPES: ReportingPeriodType[] = [
  'current_month',
  'financial_year',
  'last_12_months',
  'all_history',
  'custom',
];

export function isValidPeriodType(val: unknown): val is ReportingPeriodType {
  return typeof val === 'string' && VALID_PERIOD_TYPES.includes(val as ReportingPeriodType);
}

export function validateISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dateObj = new Date(y, m - 1, d);
  return (
    dateObj.getFullYear() === y &&
    dateObj.getMonth() === m - 1 &&
    dateObj.getDate() === d
  );
}

export interface ReportingDateRange {
  period: ReportingPeriodType;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;     // e.g. "Financial Year · Apr 1, 2026 – Mar 31, 2027"
}

export interface AccountSyncStatus {
  totalActiveAccounts: number;
  reconciledAccountsCount: number;
  unreconciledAccountsCount: number;
  lastReconciledAt: string | null;
  isFullyReconciled: boolean;
  statusLabel: string;
  details: string;
}

export interface DashboardReport {
  period: ReportingDateRange;
  generatedAt: string;

  // Real account reconciliation & sync status
  syncStatus: AccountSyncStatus;

  // 1. Net Worth Hero & Cash Position (reconstructed as of asOfDate)
  netWorth: {
    totalNetWorth: number; // in minor units
    cashPosition: number;  // sum of active bank + cash accounts as of asOfDate
    currentCashPosition: number; // today's balance
    asOfDate: string;
    isHistoricalReconstruction: boolean;
    financialAssets: number;
    nonFinancialAssets: number;
    liabilities: number; // calculated from DEBT_BORROWING - DEBT_REPAYMENT
    isFullyDerived: boolean;
    disclaimer: string;
    unavailableComponents: string[];
  };

  // 2. Selected Period Financial Metrics
  periodMetrics: {
    grossIncome: number;
    netTaxPaid: number;
    otherIncomeDeductions: number;
    netIncome: number;
    consumptionExpenses: number;
    nonFinancialAssetPurchases: number;
    totalExpenses: number;
    savings: number;
    savingsRate: number | null;
    investmentAllocation: number;
    cashRetained: number;
  };

  // 3. Cash Flow Details
  cashFlow: {
    totalInflows: number;
    totalOutflows: number;
    netMovement: number;
    internalTransferVolume: number;
    internalTransferNetImpact: 0;
    breakdown: {
      incomeInflow: number;
      receivableRepayments: number;
      borrowings: number;
      consumptionOutflow: number;
      assetPurchasesOutflow: number;
      taxOutflow: number;
      investmentOutflow: number;
      moneyLentOutflow: number;
      debtRepaymentOutflow: number;
      reconciliationAdjustments: number;
    };
  };

  // 4. Financial Composition
  composition: {
    cashPosition: number; // as of asOfDate
    bankAccountsTotal: number;
    cashAccountsTotal: number;
    accounts: {
      id: string;
      name: string;
      type: 'bank' | 'cash';
      institution?: string | null;
      calculatedBalance: number; // today's balance
      asOfBalance: number;       // reconstructed balance as of period end
      sharePercentage: number;
      lastReconciledAt?: string | null;
      isActive: boolean;
      isReconciled: boolean;
    }[];
    untrackedClasses: {
      name: string;
      status: string;
      description: string;
    }[];
  };

  // 5. Lifetime Summary
  lifetimeSummary: {
    lifetimeGrossIncome: number;
    lifetimeNetTaxPaid: number;
    lifetimeConsumptionExpenses: number;
    lifetimeTotalExpenses: number;
    lifetimeSavings: number;
    lifetimeInvestmentAllocation: number;
    totalPostedTransactions: number;
    totalActiveAccounts: number;
    earliestTransactionDate: string | null;
    disclaimer: string;
  };

  // 6. Objective Financial Health Indicators
  financialHealth: {
    savingsRate: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    cashRunwayMonths: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    debtRatio: {
      value: number;
      formatted: string;
      formula: string;
      description: string;
    };
    effectiveTaxRate: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    expenseToIncomeRatio: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
  };

  // 7. Spending by Category
  categoryBreakdown: {
    categoryId: string;
    categoryName: string;
    color: string;
    icon: string;
    amount: number;
    percentage: number;
  }[];

  // 8. Monthly Trends (taxes accounted for in net savings)
  monthlyTrends: {
    monthKey: string;
    label: string;
    grossIncome: number;
    netTaxPaid: number;
    netIncome: number;
    expenses: number;
    savings: number;
    netCashFlow: number;
  }[];

  // 9. Recent Activity Snippet
  recentTransactions: {
    id: string;
    transactionDate: string;
    description: string;
    amount: number;
    type: string;
    categoryName?: string;
    accountName?: string;
  }[];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats YYYY-MM-DD into "MMM D, YYYY" with zero timezone distortion.
 */
export function formatPrettyDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const monthName = MONTH_NAMES[monthIdx] || parts[1];
  return `${monthName} ${day}, ${year}`;
}

/**
 * Resolves exactly the specified reporting periods:
 * 1. Current Month
 * 2. Financial Year (Default: April 1 – March 31)
 * 3. Last 12 Months
 * 4. All History
 * 5. Custom Range
 */
export function resolveReportingPeriod(
  period: ReportingPeriodType = 'current_month',
  customStartDate?: string,
  customEndDate?: string,
  referenceDate: Date = new Date(),
  financialYearStartMonth = 4, // April = 4
): ReportingDateRange {
  if (!isValidPeriodType(period)) {
    throw new Error(`Invalid period type: "${period}". Must be one of: ${VALID_PERIOD_TYPES.join(', ')}`);
  }

  if (
    !Number.isInteger(financialYearStartMonth) ||
    financialYearStartMonth < 1 ||
    financialYearStartMonth > 12
  ) {
    throw new Error(
      `Invalid financialYearStartMonth: ${financialYearStartMonth}. Must be an integer between 1 and 12.`,
    );
  }

  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth(); // 0 to 11

  switch (period) {
    case 'current_month': {
      const yearStr = String(refYear);
      const monthStr = String(refMonth + 1).padStart(2, '0');
      const startDate = `${yearStr}-${monthStr}-01`;
      const lastDay = new Date(refYear, refMonth + 1, 0).getDate();
      const endDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      return {
        period: 'current_month',
        startDate,
        endDate,
        label: `Current Month · ${formatPrettyDate(startDate)} – ${formatPrettyDate(endDate)}`,
      };
    }

    case 'financial_year': {
      // Default India financial year: April 1 to March 31
      const fyStartIdx = financialYearStartMonth - 1; // 3 for April
      let startYear = refYear;
      let endYear = refYear + 1;

      if (refMonth < fyStartIdx) {
        startYear = refYear - 1;
        endYear = refYear;
      }

      const startMonthStr = String(financialYearStartMonth).padStart(2, '0');
      const startDate = `${startYear}-${startMonthStr}-01`;

      const endMonth = financialYearStartMonth === 1 ? 12 : financialYearStartMonth - 1;
      const endMonthStr = String(endMonth).padStart(2, '0');
      const endMonthLastDay = new Date(endYear, endMonth, 0).getDate();
      const endDate = `${endYear}-${endMonthStr}-${String(endMonthLastDay).padStart(2, '0')}`;

      return {
        period: 'financial_year',
        startDate,
        endDate,
        label: `Financial Year · ${formatPrettyDate(startDate)} – ${formatPrettyDate(endDate)}`,
      };
    }

    case 'last_12_months': {
      // Rolling 12 months: From 1st of month 11 months prior to end of current month
      const startD = new Date(refYear, refMonth - 11, 1);
      const startYearStr = String(startD.getFullYear());
      const startMonthStr = String(startD.getMonth() + 1).padStart(2, '0');
      const startDate = `${startYearStr}-${startMonthStr}-01`;

      const lastDay = new Date(refYear, refMonth + 1, 0).getDate();
      const endYearStr = String(refYear);
      const endMonthStr = String(refMonth + 1).padStart(2, '0');
      const endDate = `${endYearStr}-${endMonthStr}-${String(lastDay).padStart(2, '0')}`;

      return {
        period: 'last_12_months',
        startDate,
        endDate,
        label: `Last 12 Months · ${formatPrettyDate(startDate)} – ${formatPrettyDate(endDate)}`,
      };
    }

    case 'all_history': {
      return {
        period: 'all_history',
        startDate: '1970-01-01',
        endDate: '9999-12-31',
        label: 'All History · Lifetime Activity',
      };
    }

    case 'custom': {
      if (!customStartDate || !customEndDate) {
        throw new Error('startDate and endDate are required for custom period.');
      }
      if (!validateISODate(customStartDate)) {
        throw new Error(`Invalid custom startDate: "${customStartDate}". Must be in YYYY-MM-DD format.`);
      }
      if (!validateISODate(customEndDate)) {
        throw new Error(`Invalid custom endDate: "${customEndDate}". Must be in YYYY-MM-DD format.`);
      }
      if (customStartDate > customEndDate) {
        throw new Error(`startDate (${customStartDate}) cannot be after endDate (${customEndDate}).`);
      }
      return {
        period: 'custom',
        startDate: customStartDate,
        endDate: customEndDate,
        label: `Custom Range · ${formatPrettyDate(customStartDate)} – ${formatPrettyDate(customEndDate)}`,
      };
    }

    default: {
      const exhaustive: never = period;
      throw new Error(`Unsupported reporting period: ${exhaustive}`);
    }
  }
}

/**
 * Generates the complete, canonical Dashboard Report for the authenticated user.
 * Reconstructs historical balances truthfully as of the period end date.
 */
export async function getDashboardReport(
  userId: string,
  options: {
    period?: ReportingPeriodType;
    startDate?: string;
    endDate?: string;
    financialYearStartMonth?: number;
    referenceDate?: Date;
  } = {},
): Promise<DashboardReport> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const refDate = options.referenceDate || new Date();
  const refYear = refDate.getFullYear();
  const refMonth = refDate.getMonth();
  const todayDateStr = refDate.toISOString().substring(0, 10);

  const resolvedRange = resolveReportingPeriod(
    options.period || 'current_month',
    options.startDate,
    options.endDate,
    refDate,
    options.financialYearStartMonth || 4,
  );

  // Determine effective as-of date for balance and net worth reconstruction
  // If period end date is in the past (< today), we reconstruct balances as of endDate
  const isHistorical = resolvedRange.endDate < todayDateStr && resolvedRange.period !== 'all_history';
  const asOfDate = isHistorical ? resolvedRange.endDate : todayDateStr;

  // 1. Fetch all accounts for user
  const accountsSnap = await db
    .collection('users')
    .doc(userId)
    .collection('accounts')
    .get();

  const allAccounts = accountsSnap.docs.map((d) => d.data() as AccountDocument);
  const activeAccounts = allAccounts.filter((a) => a.isActive !== false);

  // Compute real account sync and reconciliation status
  let reconciledAccountsCount = 0;
  let latestReconciledAt: string | null = null;

  for (const acc of activeAccounts) {
    const isReconciled =
      acc.lastReconciledAt != null &&
      acc.reportedBalance != null &&
      acc.reportedBalance === acc.calculatedBalance;

    if (isReconciled) {
      reconciledAccountsCount++;
      if (!latestReconciledAt || (acc.lastReconciledAt && acc.lastReconciledAt > latestReconciledAt)) {
        latestReconciledAt = acc.lastReconciledAt ?? null;
      }
    }
  }

  const totalActiveAccounts = activeAccounts.length;
  const unreconciledAccountsCount = totalActiveAccounts - reconciledAccountsCount;
  const isFullyReconciled = totalActiveAccounts > 0 && unreconciledAccountsCount === 0;

  let syncStatusLabel = 'Reconciliation Pending';
  let syncStatusDetails = 'Accounts have not yet been reconciled against bank statements.';

  if (isFullyReconciled) {
    syncStatusLabel = 'All active accounts reconciled';
    syncStatusDetails = latestReconciledAt
      ? `All accounts verified. Last reconciled on ${formatPrettyDate(latestReconciledAt.substring(0, 10))}.`
      : 'All active accounts verified with zero discrepancy.';
  } else if (reconciledAccountsCount > 0) {
    syncStatusLabel = `${reconciledAccountsCount} of ${totalActiveAccounts} accounts reconciled`;
    syncStatusDetails = `${unreconciledAccountsCount} active account(s) have pending statement reconciliation.`;
  }

  const syncStatus: AccountSyncStatus = {
    totalActiveAccounts,
    reconciledAccountsCount,
    unreconciledAccountsCount,
    lastReconciledAt: latestReconciledAt,
    isFullyReconciled,
    statusLabel: syncStatusLabel,
    details: syncStatusDetails,
  };

  // 2. Fetch categories for lookup
  const categoriesSnap = await db
    .collection('users')
    .doc(userId)
    .collection('categories')
    .get();

  const categoryMap = new Map<string, { name: string; color: string; icon: string }>();
  const PALETTE = ['#44785A', '#2B4C7E', '#A8752F', '#7D4E8D', '#3F7A8D', '#9A4D3B', '#5A7D36'];
  let colorIdx = 0;
  for (const doc of categoriesSnap.docs) {
    const cat = doc.data() as CategoryDocument;
    categoryMap.set(cat.id, {
      name: cat.name,
      color: PALETTE[colorIdx % PALETTE.length],
      icon: 'category',
    });
    colorIdx++;
  }

  // 3. Transactions Querying (Bounded for performance)
  const txCol = db.collection('users').doc(userId).collection('transactions');

  // Query A: Period transactions (bounded by status == 'POSTED' and date if not all_history)
  let periodDocs: FirebaseFirestore.DocumentData[] = [];
  if (resolvedRange.period === 'all_history') {
    const snap = await txCol.where('status', '==', 'POSTED').get();
    periodDocs = snap.docs.map((d) => d.data());
  } else {
    // Bounded date query
    const snap = await txCol
      .where('status', '==', 'POSTED')
      .where('transactionDate', '>=', resolvedRange.startDate)
      .where('transactionDate', '<=', resolvedRange.endDate)
      .get();
    periodDocs = snap.docs.map((d) => d.data());
  }

  const periodTransactions = periodDocs as TransactionDocument[];

  // Sort period transactions descending by date, then by id
  periodTransactions.sort((a, b) => {
    const cmp = b.transactionDate.localeCompare(a.transactionDate);
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  });

  // Query B: Later transactions after asOfDate (only needed if historical reconstruction)
  const laterAccountDeltas = new Map<string, number>();
  if (isHistorical) {
    const laterSnap = await txCol
      .where('status', '==', 'POSTED')
      .where('transactionDate', '>', asOfDate)
      .get();
    for (const doc of laterSnap.docs) {
      const tx = doc.data() as TransactionDocument;
      const delta = getTransactionBalanceDelta(
        tx.type,
        tx.amount,
        tx.status,
        tx.transferDirection,
        tx.reconciliationDiscrepancy,
      );
      laterAccountDeltas.set(tx.accountId, (laterAccountDeltas.get(tx.accountId) || 0) + delta);
    }
  }

  // Query C: Debt borrowings and repayments on or before asOfDate for truthful liability calculation
  let cumulativeDebtBorrowing = 0;
  let cumulativeDebtRepayment = 0;

  // Query all posted debt movements
  const debtBorrowSnap = await txCol
    .where('status', '==', 'POSTED')
    .where('type', '==', 'DEBT_BORROWING')
    .get();
  for (const doc of debtBorrowSnap.docs) {
    const tx = doc.data() as TransactionDocument;
    if (tx.transactionDate <= asOfDate) {
      cumulativeDebtBorrowing += tx.amount;
    }
  }

  const debtRepaySnap = await txCol
    .where('status', '==', 'POSTED')
    .where('type', '==', 'DEBT_REPAYMENT')
    .get();
  for (const doc of debtRepaySnap.docs) {
    const tx = doc.data() as TransactionDocument;
    if (tx.transactionDate <= asOfDate) {
      cumulativeDebtRepayment += tx.amount;
    }
  }

  const outstandingDebtLiability = Math.max(0, cumulativeDebtBorrowing - cumulativeDebtRepayment);

  // 4. Reconstruct Historical Balances for Composition & Net Worth
  let currentCashPosition = 0;
  let asOfCashPosition = 0;
  let bankAccountsTotal = 0;
  let cashAccountsTotal = 0;

  const compositionAccounts = activeAccounts.map((a) => {
    const currentBal = a.calculatedBalance || 0;
    currentCashPosition += currentBal;

    let asOfBal = currentBal;
    if (isHistorical) {
      if (a.openingBalanceDate && a.openingBalanceDate > asOfDate) {
        // Account had not yet been opened as of asOfDate
        asOfBal = 0;
      } else {
        const subsequentDeltas = laterAccountDeltas.get(a.id) || 0;
        asOfBal = currentBal - subsequentDeltas;
      }
    }

    if (a.type === 'bank') {
      bankAccountsTotal += asOfBal;
    } else if (a.type === 'cash') {
      cashAccountsTotal += asOfBal;
    }

    asOfCashPosition += asOfBal;

    const isRec =
      a.lastReconciledAt != null &&
      a.reportedBalance != null &&
      a.reportedBalance === a.calculatedBalance;

    return {
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution ?? null,
      calculatedBalance: currentBal,
      asOfBalance: asOfBal,
      sharePercentage: 0, // will compute after total
      lastReconciledAt: a.lastReconciledAt ?? null,
      isActive: a.isActive !== false,
      isReconciled: isRec,
    };
  });

  // Update share percentages based on asOfCashPosition
  for (const acc of compositionAccounts) {
    const share = asOfCashPosition > 0 ? (acc.asOfBalance / asOfCashPosition) * 100 : 0;
    acc.sharePercentage = Math.max(0, Number(share.toFixed(1)));
  }

  // Sort composition accounts by asOfBalance descending
  compositionAccounts.sort((a, b) => b.asOfBalance - a.asOfBalance);

  // Net Worth truthfulness:
  // Total Net Worth = Financial Assets (asOfCashPosition) + Non-Financial Assets (0) - Liabilities (outstandingDebtLiability)
  const totalNetWorth = asOfCashPosition - outstandingDebtLiability;

  let netWorthDisclaimer = 'Based on available financial data';
  if (isHistorical) {
    netWorthDisclaimer = `Reconstructed financial position as of ${formatPrettyDate(asOfDate)} based on canonical ledger.`;
  } else if (outstandingDebtLiability > 0) {
    netWorthDisclaimer = 'Based on active financial accounts and recorded debt obligations.';
  } else {
    netWorthDisclaimer = 'Based on available financial accounts. No active debt obligations recorded.';
  }

  const unavailableComponents: string[] = ['Investments', 'Non-Financial Assets'];
  if (outstandingDebtLiability === 0) {
    unavailableComponents.push('Liabilities');
  }

  // 5. Calculate Period Metrics
  let periodGrossIncome = 0;
  let periodNetTaxPaid = 0;
  let periodConsumptionExpenses = 0;
  let periodNonFinancialAssetPurchases = 0;
  let periodInvestmentAllocation = 0;

  let incomeInflow = 0;
  let receivableRepayments = 0;
  let borrowings = 0;
  let consumptionOutflow = 0;
  let assetPurchasesOutflow = 0;
  let taxOutflow = 0;
  let investmentOutflow = 0;
  let moneyLentOutflow = 0;
  let debtRepaymentOutflow = 0;
  let reconciliationAdjustments = 0;
  let internalTransferVolume = 0;

  const categoryAmountMap = new Map<string, number>();

  for (const tx of periodTransactions) {
    switch (tx.type) {
      case 'INCOME':
        periodGrossIncome += tx.amount;
        incomeInflow += tx.amount;
        break;

      case 'TAX':
        periodNetTaxPaid += tx.amount;
        taxOutflow += tx.amount;
        break;

      case 'EXPENSE':
        periodConsumptionExpenses += tx.amount;
        consumptionOutflow += tx.amount;
        if (tx.allocations && tx.allocations.length > 0) {
          for (const alloc of tx.allocations) {
            const catId = alloc.categoryId || 'uncategorized';
            categoryAmountMap.set(catId, (categoryAmountMap.get(catId) || 0) + alloc.amount);
          }
        } else {
          const catId = tx.categoryId || 'uncategorized';
          categoryAmountMap.set(catId, (categoryAmountMap.get(catId) || 0) + tx.amount);
        }
        break;

      case 'NON_FINANCIAL_ASSET_PURCHASE':
        periodNonFinancialAssetPurchases += tx.amount;
        assetPurchasesOutflow += tx.amount;
        if (tx.allocations && tx.allocations.length > 0) {
          for (const alloc of tx.allocations) {
            const catId = alloc.categoryId || 'uncategorized';
            categoryAmountMap.set(catId, (categoryAmountMap.get(catId) || 0) + alloc.amount);
          }
        } else {
          const catId = tx.categoryId || 'uncategorized';
          categoryAmountMap.set(catId, (categoryAmountMap.get(catId) || 0) + tx.amount);
        }
        break;

      case 'INVESTMENT_ALLOCATION':
        periodInvestmentAllocation += tx.amount;
        investmentOutflow += tx.amount;
        break;

      case 'MONEY_LENT':
        moneyLentOutflow += tx.amount;
        break;

      case 'RECEIVABLE_REPAYMENT':
        receivableRepayments += tx.amount;
        break;

      case 'DEBT_BORROWING':
        borrowings += tx.amount;
        break;

      case 'DEBT_REPAYMENT':
        debtRepaymentOutflow += tx.amount;
        break;

      case 'INTERNAL_TRANSFER':
        if (tx.transferDirection === 'OUT') {
          internalTransferVolume += tx.amount;
        }
        break;

      case 'RECONCILIATION_ADJUSTMENT': {
        const delta = getTransactionBalanceDelta(
          tx.type,
          tx.amount,
          tx.status,
          tx.transferDirection,
          tx.reconciliationDiscrepancy,
        );
        reconciliationAdjustments += delta;
        break;
      }
    }
  }

  const periodTotalExpenses = periodConsumptionExpenses + periodNonFinancialAssetPurchases;
  const periodOtherIncomeDeductions = 0;
  const periodNetIncome = periodGrossIncome - periodNetTaxPaid - periodOtherIncomeDeductions;
  const periodSavings = periodNetIncome - periodTotalExpenses;

  const periodSavingsRate =
    periodNetIncome > 0
      ? Number(((periodSavings / periodNetIncome) * 100).toFixed(1))
      : null;

  const periodCashRetained = periodSavings - periodInvestmentAllocation;

  const totalInflows =
    incomeInflow + receivableRepayments + borrowings + Math.max(0, reconciliationAdjustments);
  const totalOutflows =
    consumptionOutflow +
    assetPurchasesOutflow +
    taxOutflow +
    investmentOutflow +
    moneyLentOutflow +
    debtRepaymentOutflow +
    Math.max(0, -reconciliationAdjustments);
  const netMovement = totalInflows - totalOutflows;

  // 6. Query Lifetime & Monthly Trends Transactions
  // When period is all_history, allPostedTransactions is already periodTransactions.
  // Otherwise, query posted transactions using status index to exclude draft/void transactions.
  let allPostedTransactions: TransactionDocument[] = [];
  if (resolvedRange.period === 'all_history') {
    allPostedTransactions = periodTransactions;
  } else {
    const allPostedSnap = await txCol.where('status', '==', 'POSTED').get();
    allPostedTransactions = allPostedSnap.docs.map((d) => d.data() as TransactionDocument);
  }

  let lifetimeGrossIncome = 0;
  let lifetimeNetTaxPaid = 0;
  let lifetimeConsumptionExpenses = 0;
  let lifetimeNonFinancialAssetPurchases = 0;
  let lifetimeInvestmentAllocation = 0;
  let earliestTransactionDate: string | null = null;

  for (const tx of allPostedTransactions) {
    if (!earliestTransactionDate || tx.transactionDate < earliestTransactionDate) {
      earliestTransactionDate = tx.transactionDate;
    }

    switch (tx.type) {
      case 'INCOME':
        lifetimeGrossIncome += tx.amount;
        break;
      case 'TAX':
        lifetimeNetTaxPaid += tx.amount;
        break;
      case 'EXPENSE':
        lifetimeConsumptionExpenses += tx.amount;
        break;
      case 'NON_FINANCIAL_ASSET_PURCHASE':
        lifetimeNonFinancialAssetPurchases += tx.amount;
        break;
      case 'INVESTMENT_ALLOCATION':
        lifetimeInvestmentAllocation += tx.amount;
        break;
    }
  }

  const lifetimeTotalExpenses = lifetimeConsumptionExpenses + lifetimeNonFinancialAssetPurchases;
  const lifetimeNetIncome = lifetimeGrossIncome - lifetimeNetTaxPaid;
  const lifetimeSavings = lifetimeNetIncome - lifetimeTotalExpenses;

  // 7. Objective Financial Health Indicators
  // IMPORTANT: Cash Runway uses CONSUMPTION EXPENSES (excluding non-financial asset purchases)
  let cashRunwayMonths: number | null = null;
  let runwayFormatted = '—';

  if (asOfCashPosition <= 0) {
    cashRunwayMonths = 0;
    runwayFormatted = '0.0 months';
  } else if (periodConsumptionExpenses > 0) {
    const startMs = new Date(resolvedRange.startDate).getTime();
    const endMs = new Date(resolvedRange.endDate).getTime();
    const diffDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
    const periodMonths = Math.max(diffDays / 30.4375, 1);
    const avgMonthlyConsumption = periodConsumptionExpenses / periodMonths;
    if (avgMonthlyConsumption > 0) {
      cashRunwayMonths = Number((asOfCashPosition / avgMonthlyConsumption).toFixed(1));
      runwayFormatted = `${cashRunwayMonths} months`;
    }
  } else if (lifetimeConsumptionExpenses > 0) {
    // Fallback to lifetime average monthly consumption
    const earliestMs = earliestTransactionDate ? new Date(earliestTransactionDate).getTime() : Date.now();
    const totalDays = Math.max(30, Math.round((Date.now() - earliestMs) / (1000 * 60 * 60 * 24)));
    const totalMonths = totalDays / 30.4375;
    const avgMonthlyConsumption = lifetimeConsumptionExpenses / totalMonths;
    if (avgMonthlyConsumption > 0) {
      cashRunwayMonths = Number((asOfCashPosition / avgMonthlyConsumption).toFixed(1));
      runwayFormatted = `${cashRunwayMonths} months`;
    }
  }

  // Debt Ratio: Calculated truthfully from active debt borrowings and repayments
  let debtRatioVal = 0.0;
  let debtRatioFormatted = '0.0%';
  let debtRatioDesc = 'Zero active debt liabilities recorded in current transaction ledger.';

  if (asOfCashPosition > 0) {
    debtRatioVal = Number(((outstandingDebtLiability / asOfCashPosition) * 100).toFixed(1));
    debtRatioFormatted = `${debtRatioVal}%`;
    if (outstandingDebtLiability > 0) {
      debtRatioDesc = 'Cumulative debt borrowings minus repayments relative to liquid financial assets.';
    }
  } else if (outstandingDebtLiability > 0) {
    debtRatioVal = 100.0;
    debtRatioFormatted = '>100%';
    debtRatioDesc = 'Active debt liabilities exceed liquid cash reserves.';
  }

  const effectiveTaxRate =
    periodGrossIncome > 0
      ? Number(((periodNetTaxPaid / periodGrossIncome) * 100).toFixed(1))
      : null;

  const expenseToIncomeRatio =
    periodNetIncome > 0
      ? Number(((periodTotalExpenses / periodNetIncome) * 100).toFixed(1))
      : null;

  const financialHealth = {
    savingsRate: {
      value: periodSavingsRate,
      formatted: periodSavingsRate !== null ? `${periodSavingsRate}%` : '—',
      formula: 'Savings / Net Income',
      description: 'Proportion of net earnings retained after consumption and non-financial asset purchases.',
    },
    cashRunwayMonths: {
      value: cashRunwayMonths,
      formatted: runwayFormatted,
      formula: 'Current Liquid Cash Position / Average Monthly Consumption Expenses',
      description: 'Estimated duration current cash reserves can sustain average monthly consumption expenditures (excluding asset purchases).',
    },
    debtRatio: {
      value: debtRatioVal,
      formatted: debtRatioFormatted,
      formula: 'Total Outstanding Debt Liabilities / Liquid Financial Assets',
      description: debtRatioDesc,
    },
    effectiveTaxRate: {
      value: effectiveTaxRate,
      formatted: effectiveTaxRate !== null ? `${effectiveTaxRate}%` : '—',
      formula: 'Net Tax Paid / Gross Income',
      description: 'Ratio of direct tax cash outflows relative to gross income for the reporting period.',
    },
    expenseToIncomeRatio: {
      value: expenseToIncomeRatio,
      formatted: expenseToIncomeRatio !== null ? `${expenseToIncomeRatio}%` : '—',
      formula: 'Total Expenses / Net Income',
      description: 'Proportion of net income absorbed by consumption and asset purchases.',
    },
  };

  // 8. Category Breakdown
  const categoryBreakdown: DashboardReport['categoryBreakdown'] = [];
  let totalCategorizedAmount = 0;
  for (const amt of categoryAmountMap.values()) {
    totalCategorizedAmount += amt;
  }

  for (const [catId, amt] of categoryAmountMap.entries()) {
    const meta = categoryMap.get(catId);
    const catName = meta ? meta.name : catId === 'uncategorized' ? 'General / Uncategorized' : 'Uncategorized';
    const catColor = meta ? meta.color : '#8C8C8C';
    const catIcon = meta ? meta.icon : 'folder';
    const pct = totalCategorizedAmount > 0 ? (amt / totalCategorizedAmount) * 100 : 0;

    categoryBreakdown.push({
      categoryId: catId,
      categoryName: catName,
      color: catColor,
      icon: catIcon,
      amount: amt,
      percentage: Number(pct.toFixed(1)),
    });
  }
  categoryBreakdown.sort((a, b) => b.amount - a.amount);

  // 9. Monthly Trends (Subtracting Taxes for True Net Savings)
  // Bounded to last 12 months for high performance
  const monthlyBuckets = new Map<
    string,
    { income: number; tax: number; expenses: number; inflows: number; outflows: number }
  >();

  const twelveMonthsAgoDate = new Date(refYear, refMonth - 11, 1);
  const twelveMonthsAgoStr = `${twelveMonthsAgoDate.getFullYear()}-${String(twelveMonthsAgoDate.getMonth() + 1).padStart(2, '0')}-01`;

  const trendTransactions =
    resolvedRange.period === 'last_12_months'
      ? periodTransactions
      : allPostedTransactions.filter((t) => t.transactionDate >= twelveMonthsAgoStr);

  for (const tx of trendTransactions) {
    if (tx.transactionDate.length >= 7) {
      const monthKey = tx.transactionDate.substring(0, 7);
      if (!monthlyBuckets.has(monthKey)) {
        monthlyBuckets.set(monthKey, { income: 0, tax: 0, expenses: 0, inflows: 0, outflows: 0 });
      }
      const b = monthlyBuckets.get(monthKey)!;
      if (tx.type === 'INCOME') {
        b.income += tx.amount;
        b.inflows += tx.amount;
      } else if (tx.type === 'TAX') {
        b.tax += tx.amount;
        b.outflows += tx.amount;
      } else if (tx.type === 'EXPENSE' || tx.type === 'NON_FINANCIAL_ASSET_PURCHASE') {
        b.expenses += tx.amount;
        b.outflows += tx.amount;
      } else if (tx.type === 'INVESTMENT_ALLOCATION' || tx.type === 'MONEY_LENT' || tx.type === 'DEBT_REPAYMENT') {
        b.outflows += tx.amount;
      } else if (tx.type === 'RECEIVABLE_REPAYMENT' || tx.type === 'DEBT_BORROWING') {
        b.inflows += tx.amount;
      }
    }
  }

  const sortedMonthKeys = Array.from(monthlyBuckets.keys()).sort();
  const recentMonthKeys = sortedMonthKeys.slice(-12);
  const monthlyTrends: DashboardReport['monthlyTrends'] = recentMonthKeys.map((mk) => {
    const data = monthlyBuckets.get(mk)!;
    const parts = mk.split('-');
    const y = parts[0];
    const m = parseInt(parts[1], 10) - 1;
    const label = `${MONTH_NAMES[m] || parts[1]} ${y}`;
    const netIncome = data.income - data.tax;
    const savings = netIncome - data.expenses;

    return {
      monthKey: mk,
      label,
      grossIncome: data.income,
      netTaxPaid: data.tax,
      netIncome,
      expenses: data.expenses,
      savings,
      netCashFlow: data.inflows - data.outflows,
    };
  });

  // 10. Recent Activity Snippet (top 5 posted transactions using bounded query with index)
  const accountNameMap = new Map<string, string>();
  for (const a of allAccounts) {
    accountNameMap.set(a.id, a.name);
  }

  const recentSnap = await txCol
    .where('status', '==', 'POSTED')
    .orderBy('transactionDate', 'desc')
    .orderBy('id', 'desc')
    .limit(5)
    .get();

  const recentTransactions = recentSnap.docs.map((d) => {
    const t = d.data() as TransactionDocument;
    const cat = t.categoryId ? categoryMap.get(t.categoryId) : undefined;
    return {
      id: t.id,
      transactionDate: t.transactionDate,
      description: t.description,
      amount: t.amount,
      type: t.type,
      categoryName: cat ? cat.name : undefined,
      accountName: accountNameMap.get(t.accountId) || 'Account',
    };
  });

  return {
    period: resolvedRange,
    generatedAt: new Date().toISOString(),
    syncStatus,
    netWorth: {
      totalNetWorth,
      cashPosition: asOfCashPosition,
      currentCashPosition,
      asOfDate,
      isHistoricalReconstruction: isHistorical,
      financialAssets: asOfCashPosition,
      nonFinancialAssets: 0,
      liabilities: outstandingDebtLiability,
      isFullyDerived: false,
      disclaimer: netWorthDisclaimer,
      unavailableComponents,
    },
    periodMetrics: {
      grossIncome: periodGrossIncome,
      netTaxPaid: periodNetTaxPaid,
      otherIncomeDeductions: periodOtherIncomeDeductions,
      netIncome: periodNetIncome,
      consumptionExpenses: periodConsumptionExpenses,
      nonFinancialAssetPurchases: periodNonFinancialAssetPurchases,
      totalExpenses: periodTotalExpenses,
      savings: periodSavings,
      savingsRate: periodSavingsRate,
      investmentAllocation: periodInvestmentAllocation,
      cashRetained: periodCashRetained,
    },
    cashFlow: {
      totalInflows,
      totalOutflows,
      netMovement,
      internalTransferVolume,
      internalTransferNetImpact: 0,
      breakdown: {
        incomeInflow,
        receivableRepayments,
        borrowings,
        consumptionOutflow,
        assetPurchasesOutflow,
        taxOutflow,
        investmentOutflow,
        moneyLentOutflow,
        debtRepaymentOutflow,
        reconciliationAdjustments,
      },
    },
    composition: {
      cashPosition: asOfCashPosition,
      bankAccountsTotal,
      cashAccountsTotal,
      accounts: compositionAccounts,
      untrackedClasses: [
        {
          name: 'Investments',
          status: 'Not yet tracked in Slice 4',
          description: 'Equity, mutual funds, and fixed deposits subsystems will be added in subsequent slices.',
        },
        {
          name: 'Non-Financial Assets',
          status: 'Not yet tracked in Slice 4',
          description: 'Real estate, vehicles, and precious physical assets will populate net worth in future slices.',
        },
        {
          name: 'Liabilities & Loans',
          status: outstandingDebtLiability > 0 ? 'Partially derived from ledger' : 'Not yet tracked in Slice 4',
          description:
            outstandingDebtLiability > 0
              ? `Outstanding recorded debt: ₹${(outstandingDebtLiability / 100).toLocaleString('en-IN')}. Specialized loan accounts and amortization schedules will be added in future slices.`
              : 'Credit cards and debt schedules are not yet active in the current ledger.',
        },
      ],
    },
    lifetimeSummary: {
      lifetimeGrossIncome,
      lifetimeNetTaxPaid,
      lifetimeConsumptionExpenses,
      lifetimeTotalExpenses,
      lifetimeSavings,
      lifetimeInvestmentAllocation,
      totalPostedTransactions: allPostedTransactions.length,
      totalActiveAccounts: activeAccounts.length,
      earliestTransactionDate,
      disclaimer: 'Based on available data',
    },
    financialHealth,
    categoryBreakdown,
    monthlyTrends,
    recentTransactions,
  };
}
