# Fractal Finance — Dashboard Reporting Architecture & Projections

This document specifies the reporting architecture, projection strategy, query performance characteristics, and consistency guarantees implemented in Fractal Finance Slice 4.

---

## 1. Architectural Principles

1. **Canonical Ledger as Source of Truth**:
   The `transactions`, `accounts`, and `balanceSnapshots` collections remain the authoritative financial ledger. Dashboard reports never maintain independent, out-of-sync financial balances.
2. **Rebuildable Derived Projections**:
   To prevent unbounded table scans on dashboard requests (especially with 10,000+ or 100,000+ transactions), derived aggregates are maintained in a separate document: `users/{userId}/projections/dashboard`.
   - The projection is completely separate from the ledger.
   - It is updated incrementally on transaction creation, editing, voiding, and balance reconciliation adjustments.
   - It can be recalculated from the canonical ledger at any time via `rebuildProjectionFromLedger(userId)`.
   - Consistency can be audited via `verifyProjectionConsistency(userId)`.

---

## 2. Dashboard Query Complexity & Read Costs

| Report Element | Previous Strategy (Slice 4 initial) | Scalable Strategy (Slice 4 hardened) | Firestore Read Cost |
| :--- | :--- | :--- | :--- |
| **Lifetime Totals** | Unbounded scan of all posted transactions (`txCol.where('status', '==', 'POSTED').get()`) | Read from `projections/dashboard` document | **1 document read** (O(1)) |
| **Current Debt Liabilities** | Unbounded scan of all `DEBT_BORROWING` and `DEBT_REPAYMENT` transactions across all time | Read from `projections/dashboard.debt` | **0 transaction reads** (O(1)) |
| **Historical Debt Liabilities** | Full scan of all debt movements filtered by `transactionDate <= asOfDate` in application memory | Subtracts only debt movements occurring strictly *after* `asOfDate` (`transactionDate > asOfDate`) | **Bounded** to subsequent movements (typically 0–5 reads) |
| **Historical Account Balances** | Reverses deltas occurring strictly after `asOfDate` (`transactionDate > asOfDate`) | Reverses deltas occurring strictly after `asOfDate` (`transactionDate > asOfDate`) | **Bounded** to subsequent movements (0 when viewing current period) |
| **Monthly Trends** | Scanned all posted transactions in history to compute monthly buckets | Bounded query strictly to the rolling 12-month window (`transactionDate >= twelveMonthsAgoStr`) | **Bounded** to at most 12 months of transactions |
| **Recent Activity** | Sorted all lifetime posted transactions in JS memory and sliced 5 | Indexed query `.orderBy('transactionDate', 'desc').orderBy('id', 'desc').limit(5)` | **Strictly 5 document reads** |
| **Selected Period Activity** | Bounded by date range `transactionDate >= startDate && transactionDate <= endDate` | Bounded by date range `transactionDate >= startDate && transactionDate <= endDate` | **Bounded** to transactions within the period |
| **Account Sync Status** | Computed from active account documents | Computed from active account documents | **Bounded** to active account count |

### Ordinary Dashboard Request Performance
For an ordinary dashboard view (such as Current Month, Financial Year, or Last 12 Months):
- Total Firestore reads: ~10 to 30 documents.
- Execution time: < 100ms.
- Scalability: Constant cost regardless of whether the user has 100 or 100,000 transactions in history.

---

## 3. Projection Maintenance & Consistency

Projections are synchronized across all canonical mutation paths:
1. `createTransaction`: Increments projection lifetime and monthly summary.
2. `createInternalTransfer`: Paired transfers with net impact zero.
3. `updateTransaction`: Reverts previous transaction delta and applies updated transaction delta.
4. `voidTransaction`: Reverses transaction delta and decrements posted count.
5. `createBalanceSnapshot` (Reconciliation): Syncs `RECONCILIATION_ADJUSTMENT` transactions when discrepancy adjustments are applied.

### Consistency Verification
The system provides a built-in verification suite:
- `verifyProjectionConsistency(userId)`: Re-aggregates the canonical ledger from scratch and compares every lifetime total, debt obligation, and transaction count against the projection document.
- API Endpoint: `GET /api/reports/dashboard/projection-status`
- API Rebuild: `POST /api/reports/dashboard/rebuild-projection`

---

## 4. Tradeoffs and Consistency Semantics

1. **Read Cost vs Write Cost**:
   Updating projections adds an asynchronous, non-blocking write on transaction mutation. In exchange, dashboard read costs drop from O(N) to O(1).
2. **Eventual Consistency on Failures**:
   If an asynchronous projection write encounters a network glitch, the ledger remains authoritative. On the next dashboard load or via `rebuildProjectionFromLedger`, the projection is healed from the ledger.
3. **Historical Reconstruction Range**:
   Reconstructing balances for a date far in the past reads transactions from that date to today. This represents the minimal delta necessary to compute point-in-time balances without storing daily ledger snapshots.
