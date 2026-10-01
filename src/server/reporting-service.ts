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

export interface ReportingDateRange {
  period: ReportingPeriodType;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;     // e.g. "Financial Year · Apr 1, 2026 – Mar 31, 2027"
}

export interface DashboardReport {
  period: ReportingDateRange;
  generatedAt: string;

  // 1. Net Worth Hero & Cash Position
  netWorth: {
    totalNetWorth: number; // in minor units
    cashPosition: number;  // sum of active bank + cash accounts
    financialAssets: number;
    nonFinancialAssets: number;
    liabilities: number;
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
    cashPosition: number;
    bankAccountsTotal: number;
    cashAccountsTotal: number;
    accounts: {
      id: string;
      name: string;
      type: 'bank' | 'cash';
      institution?: string | null;
      calculatedBalance: number;
      sharePercentage: number;
      lastReconciledAt?: string | null;
      isActive: boolean;
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

  // 8. Monthly Trends
  monthlyTrends: {
    monthKey: string;
    label: string;
    income: number;
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
      // If current month >= (financialYearStartMonth - 1), we are in FY starting in refYear
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
      if (customStartDate && customEndDate && customStartDate <= customEndDate) {
        return {
          period: 'custom',
          startDate: customStartDate,
          endDate: customEndDate,
          label: `Custom Range · ${formatPrettyDate(customStartDate)} – ${formatPrettyDate(customEndDate)}`,
        };
      }
      // Fallback if missing or invalid
      const yearStr = String(refYear);
      const monthStr = String(refMonth + 1).padStart(2, '0');
      const startDate = `${yearStr}-${monthStr}-01`;
      const lastDay = new Date(refYear, refMonth + 1, 0).getDate();
      const endDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      return {
        period: 'custom',
        startDate,
        endDate,
        label: `Custom Range · ${formatPrettyDate(startDate)} – ${formatPrettyDate(endDate)}`,
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

  const resolvedRange = resolveReportingPeriod(
    options.period || 'current_month',
    options.startDate,
    options.endDate,
    options.referenceDate || new Date(),
    options.financialYearStartMonth || 4,
  );

  // 1. Fetch all accounts for user
  const accountsSnap = await db
    .collection('users')
    .doc(userId)
    .collection('accounts')
    .get();

  const allAccounts = accountsSnap.docs.map((d) => d.data() as AccountDocument);
  const activeAccounts = allAccounts.filter((a) => a.isActive !== false);

  // Sum bank and cash accounts
  let bankAccountsTotal = 0;
  let cashAccountsTotal = 0;

  for (const acc of activeAccounts) {
    const bal = acc.calculatedBalance || 0;
    if (acc.type === 'bank') {
      bankAccountsTotal += bal;
    } else if (acc.type === 'cash') {
      cashAccountsTotal += bal;
    }
  }

  const cashPosition = bankAccountsTotal + cashAccountsTotal;

  // Composition accounts breakdown
  const compositionAccounts = activeAccounts.map((a) => {
    const bal = a.calculatedBalance || 0;
    const share = cashPosition > 0 ? (bal / cashPosition) * 100 : 0;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution ?? null,
      calculatedBalance: bal,
      sharePercentage: Math.max(0, Number(share.toFixed(1))),
      lastReconciledAt: a.lastReconciledAt ?? null,
      isActive: a.isActive !== false,
    };
  });

  // Sort composition accounts by balance descending
  compositionAccounts.sort((a, b) => b.calculatedBalance - a.calculatedBalance);

  // 2. Fetch all categories for lookup
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

  // 3. Fetch all transactions for user
  const transactionsSnap = await db
    .collection('users')
    .doc(userId)
    .collection('transactions')
    .get();

  const allTransactions = transactionsSnap.docs.map((d) => d.data() as TransactionDocument);
  const postedTransactions = allTransactions.filter((t) => t.status === 'POSTED');

  // Sort posted transactions descending by date, then by id
  postedTransactions.sort((a, b) => {
    const cmp = b.transactionDate.localeCompare(a.transactionDate);
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  });

  // Filter transactions for the selected reporting period
  const periodTransactions = postedTransactions.filter(
    (t) => t.transactionDate >= resolvedRange.startDate && t.transactionDate <= resolvedRange.endDate,
  );

  // 4. Calculate period metrics
  let periodGrossIncome = 0;
  let periodNetTaxPaid = 0;
  let periodConsumptionExpenses = 0;
  let periodNonFinancialAssetPurchases = 0;
  let periodInvestmentAllocation = 0;

  // Cash flow components
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

  // Category spending aggregation
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
        // Category accumulation
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

  // Total Expenses & Net Income & Savings
  const periodTotalExpenses = periodConsumptionExpenses + periodNonFinancialAssetPurchases;
  const periodOtherIncomeDeductions = 0; // Specialized deduction entities not yet present
  const periodNetIncome = periodGrossIncome - periodNetTaxPaid - periodOtherIncomeDeductions;
  const periodSavings = periodNetIncome - periodTotalExpenses;

  // Savings Rate: Only when Net Income > 0, otherwise null
  const periodSavingsRate =
    periodNetIncome > 0
      ? Number(((periodSavings / periodNetIncome) * 100).toFixed(1))
      : null;

  const periodCashRetained = periodSavings - periodInvestmentAllocation;

  // Cash flow totals
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

  // 5. Lifetime metrics across all posted transactions
  let lifetimeGrossIncome = 0;
  let lifetimeNetTaxPaid = 0;
  let lifetimeConsumptionExpenses = 0;
  let lifetimeNonFinancialAssetPurchases = 0;
  let lifetimeInvestmentAllocation = 0;
  let earliestTransactionDate: string | null = null;

  for (const tx of postedTransactions) {
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

  // 6. Objective Financial Health Indicators (pure math, no score words)
  // Runway: Months of average monthly expenses covered by current liquid cash position
  let cashRunwayMonths: number | null = null;
  let runwayFormatted = '—';
  if (cashPosition <= 0) {
    cashRunwayMonths = 0;
    runwayFormatted = '0.0 months';
  } else if (periodTotalExpenses > 0) {
    // Estimate months in the selected period (minimum 1)
    const startMs = new Date(resolvedRange.startDate).getTime();
    const endMs = new Date(resolvedRange.endDate).getTime();
    const diffDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
    const periodMonths = Math.max(diffDays / 30.4375, 1);
    const avgMonthlyExp = periodTotalExpenses / periodMonths;
    if (avgMonthlyExp > 0) {
      cashRunwayMonths = Number((cashPosition / avgMonthlyExp).toFixed(1));
      runwayFormatted = `${cashRunwayMonths} months`;
    }
  } else if (lifetimeTotalExpenses > 0) {
    // Fallback to lifetime monthly average if period has no expenses yet
    const earliestMs = earliestTransactionDate ? new Date(earliestTransactionDate).getTime() : Date.now();
    const totalDays = Math.max(30, Math.round((Date.now() - earliestMs) / (1000 * 60 * 60 * 24)));
    const totalMonths = totalDays / 30.4375;
    const avgMonthlyExp = lifetimeTotalExpenses / totalMonths;
    if (avgMonthlyExp > 0) {
      cashRunwayMonths = Number((cashPosition / avgMonthlyExp).toFixed(1));
      runwayFormatted = `${cashRunwayMonths} months`;
    }
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
      formula: 'Current Liquid Cash Position / Average Monthly Total Expenses',
      description: 'Estimated duration current cash reserves can sustain average monthly operational expenditures.',
    },
    debtRatio: {
      value: 0.0,
      formatted: '0.0%',
      formula: 'Total Active Liabilities / Total Financial Assets',
      description: 'Zero active debt liabilities recorded in current canonical ledger.',
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

  // 7. Category Breakdown
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

  // 8. Monthly Trends (group posted transactions into monthly buckets)
  const monthlyBuckets = new Map<string, { income: number; expenses: number; inflows: number; outflows: number }>();
  for (const tx of postedTransactions) {
    if (tx.transactionDate.length >= 7) {
      const monthKey = tx.transactionDate.substring(0, 7); // "YYYY-MM"
      if (!monthlyBuckets.has(monthKey)) {
        monthlyBuckets.set(monthKey, { income: 0, expenses: 0, inflows: 0, outflows: 0 });
      }
      const b = monthlyBuckets.get(monthKey)!;
      if (tx.type === 'INCOME') {
        b.income += tx.amount;
        b.inflows += tx.amount;
      } else if (tx.type === 'EXPENSE' || tx.type === 'NON_FINANCIAL_ASSET_PURCHASE') {
        b.expenses += tx.amount;
        b.outflows += tx.amount;
      } else if (tx.type === 'TAX' || tx.type === 'INVESTMENT_ALLOCATION' || tx.type === 'MONEY_LENT' || tx.type === 'DEBT_REPAYMENT') {
        b.outflows += tx.amount;
      } else if (tx.type === 'RECEIVABLE_REPAYMENT' || tx.type === 'DEBT_BORROWING') {
        b.inflows += tx.amount;
      }
    }
  }

  const sortedMonthKeys = Array.from(monthlyBuckets.keys()).sort();
  // Take the most recent 12 months (or available)
  const recentMonthKeys = sortedMonthKeys.slice(-12);
  const monthlyTrends: DashboardReport['monthlyTrends'] = recentMonthKeys.map((mk) => {
    const data = monthlyBuckets.get(mk)!;
    const parts = mk.split('-');
    const y = parts[0];
    const m = parseInt(parts[1], 10) - 1;
    const label = `${MONTH_NAMES[m] || parts[1]} ${y}`;
    return {
      monthKey: mk,
      label,
      income: data.income,
      expenses: data.expenses,
      savings: data.income - data.expenses,
      netCashFlow: data.inflows - data.outflows,
    };
  });

  // 9. Recent Activity Snippet (top 5 posted transactions)
  const accountNameMap = new Map<string, string>();
  for (const a of allAccounts) {
    accountNameMap.set(a.id, a.name);
  }

  const recentTransactions = postedTransactions.slice(0, 5).map((t) => {
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
    netWorth: {
      totalNetWorth: cashPosition,
      cashPosition,
      financialAssets: cashPosition,
      nonFinancialAssets: 0,
      liabilities: 0,
      isFullyDerived: false,
      disclaimer: 'Based on available financial data',
      unavailableComponents: ['Investments', 'Non-Financial Assets', 'Liabilities'],
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
      cashPosition,
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
          status: 'Not yet tracked in Slice 4',
          description: 'Credit cards and debt schedules are not yet active in the current ledger.',
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
      totalPostedTransactions: postedTransactions.length,
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
