import express, { Request, Response } from 'express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticateToken, requireVerifiedEmail, AuthenticatedRequest } from './server/auth-middleware.js';
import { getPinStatus, setPinVerifier, verifyUserPin } from './server/pin-service.js';
import { getFirebaseAdmin } from './server/firebase-admin.js';
import {
  createAccount,
  updateAccount,
  getAccounts,
  getAccount,
  reconcileAccount,
  getBalanceHistory,
  recalculateAccountBalanceFromLedger,
} from './server/account-service.js';
import {
  createTransaction,
  createInternalTransfer,
  updateTransaction,
  voidTransaction,
  getTransaction,
  getTransactions,
  TransactionFilterParams,
} from './server/transaction-service.js';
import {
  getCategories,
  createCategory,
  updateCategory,
  getCounterparties,
  createCounterparty,
  updateCounterparty,
  getTags,
  createTag,
  updateTag,
} from './server/metadata-service.js';
import {
  getDashboardReport,
  ReportingPeriodType,
} from './server/reporting-service.js';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json());

// Initialize Firebase Admin SDK early
getFirebaseAdmin();

/**
 * Health & diagnostic check endpoint
 */
app.get('/api/health', (_req: Request, res: Response) => {
  const { initialized } = getFirebaseAdmin();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    firebaseAdminInitialized: initialized,
    version: '1.0.0',
  });
});

/**
 * Validates session token and returns derived user claims
 */
app.get('/api/auth/session', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    user: req.user,
  });
});

/**
 * PIN Status: tells client whether a PIN is configured without revealing verifier
 */
app.get('/api/security/pin/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await getPinStatus(req.user!.uid);
    res.json(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve PIN status';
    res.status(500).json({ error: 'PIN_STATUS_ERROR', message });
  }
});

/**
 * Set PIN verifier: hashes on server with PBKDF2-SHA256 and stores in security collection
 */
app.post('/api/security/pin/set', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      res.status(400).json({ error: 'INVALID_PIN', message: 'PIN is required and must be a string.' });
      return;
    }

    await setPinVerifier(req.user!.uid, pin);
    res.json({ success: true, message: 'PIN configured successfully.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set PIN';
    res.status(400).json({ error: 'PIN_SET_ERROR', message });
  }
});

/**
 * Verify PIN: compares against stored verifier without sending secrets to client
 */
app.post('/api/security/pin/verify', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      res.status(400).json({ error: 'INVALID_PIN', message: 'PIN is required.' });
      return;
    }

    const isValid = await verifyUserPin(req.user!.uid, pin);
    if (!isValid) {
      res.status(401).json({ valid: false, error: 'INVALID_PIN', message: 'Incorrect PIN.' });
      return;
    }

    res.json({ valid: true, verifiedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to verify PIN';
    res.status(500).json({ error: 'PIN_VERIFY_ERROR', message });
  }
});

// ==========================================
// Slice 2: Accounts, Balances & Reconciliation
// ==========================================

/**
 * POST /api/accounts: Create a new bank account or canonical cash account.
 */
app.post('/api/accounts', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const account = await createAccount(req.user!.uid, req.body);
    res.status(201).json(account);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'DUPLICATE_CASH_ACCOUNT') {
      res.status(409).json({ error: 'DUPLICATE_CASH_ACCOUNT', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to create account';
    res.status(400).json({ error: 'ACCOUNT_CREATION_FAILED', message });
  }
});

/**
 * GET /api/accounts: List all accounts for the authenticated user.
 */
app.get('/api/accounts', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accounts = await getAccounts(req.user!.uid);
    res.json(accounts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve accounts';
    res.status(500).json({ error: 'ACCOUNTS_FETCH_FAILED', message });
  }
});

/**
 * GET /api/accounts/:id: Retrieve details of a specific account.
 */
app.get('/api/accounts/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.params['id'] as string;
    const account = await getAccount(req.user!.uid, accountId);
    res.json(account);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to retrieve account';
    res.status(500).json({ error: 'ACCOUNT_FETCH_FAILED', message });
  }
});

/**
 * PUT /api/accounts/:id: Update account metadata, opening balance, or active state.
 */
app.put('/api/accounts/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.params['id'] as string;
    const account = await updateAccount(req.user!.uid, accountId, req.body);
    res.json(account);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to update account';
    res.status(400).json({ error: 'ACCOUNT_UPDATE_FAILED', message });
  }
});

/**
 * POST /api/accounts/:id/reconcile: Capture reported balance snapshot and reconcile.
 */
app.post('/api/accounts/:id/reconcile', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.params['id'] as string;
    const result = await reconcileAccount(req.user!.uid, accountId, req.body);
    res.json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to reconcile account';
    res.status(400).json({ error: 'RECONCILIATION_FAILED', message });
  }
});

/**
 * GET /api/accounts/:id/balance-history: Retrieve balance snapshots for the account.
 */
app.get('/api/accounts/:id/balance-history', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.params['id'] as string;
    const history = await getBalanceHistory(req.user!.uid, accountId);
    res.json(history);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch balance history';
    res.status(500).json({ error: 'BALANCE_HISTORY_FAILED', message });
  }
});

/**
 * POST /api/accounts/:id/recalculate: Normalize account balance strictly around ledger transactions.
 */
app.post('/api/accounts/:id/recalculate', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.params['id'] as string;
    const result = await recalculateAccountBalanceFromLedger(req.user!.uid, accountId);
    res.json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to recalculate balance';
    res.status(400).json({ error: 'RECALCULATE_FAILED', message });
  }
});

// ==========================================
// Slice 3: Transactions, Splits, Transfers & Metadata
// ==========================================

/**
 * POST /api/transactions: Create standard or split transaction.
 */
app.post('/api/transactions', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const tx = await createTransaction(req.user!.uid, {
      ...req.body,
      idempotencyKey,
    });
    res.status(201).json(tx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create transaction';
    res.status(400).json({ error: 'TRANSACTION_CREATION_FAILED', message });
  }
});

/**
 * POST /api/transactions/transfer: Atomic internal transfer pairing.
 */
app.post('/api/transactions/transfer', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const result = await createInternalTransfer(req.user!.uid, {
      ...req.body,
      idempotencyKey,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create transfer';
    res.status(400).json({ error: 'TRANSFER_CREATION_FAILED', message });
  }
});

/**
 * GET /api/transactions: Filtered & paginated transactions list.
 */
app.get('/api/transactions', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filterParams: TransactionFilterParams = {
      accountId: req.query['accountId'] as string | undefined,
      type: req.query['type'] as TransactionFilterParams['type'],
      categoryId: req.query['categoryId'] as string | undefined,
      counterpartyId: req.query['counterpartyId'] as string | undefined,
      tag: req.query['tag'] as string | undefined,
      status: req.query['status'] as TransactionFilterParams['status'],
      startDate: req.query['startDate'] as string | undefined,
      endDate: req.query['endDate'] as string | undefined,
      search: req.query['search'] as string | undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
      cursor: req.query['cursor'] as string | undefined,
    };

    const result = await getTransactions(req.user!.uid, filterParams);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve transactions';
    res.status(500).json({ error: 'TRANSACTIONS_FETCH_FAILED', message });
  }
});

/**
 * GET /api/transactions/:id: Retrieve single transaction.
 */
app.get('/api/transactions/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const txId = req.params['id'] as string;
    const tx = await getTransaction(req.user!.uid, txId);
    res.json(tx);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'TRANSACTION_NOT_FOUND') {
      res.status(404).json({ error: 'TRANSACTION_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to retrieve transaction';
    res.status(500).json({ error: 'TRANSACTION_FETCH_FAILED', message });
  }
});

/**
 * PUT /api/transactions/:id: Edit existing transaction.
 */
app.put('/api/transactions/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const txId = req.params['id'] as string;
    const updated = await updateTransaction(req.user!.uid, txId, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'TRANSACTION_NOT_FOUND') {
      res.status(404).json({ error: 'TRANSACTION_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to update transaction';
    res.status(400).json({ error: 'TRANSACTION_UPDATE_FAILED', message });
  }
});

/**
 * POST /api/transactions/:id/void: Safely void a transaction.
 */
app.post('/api/transactions/:id/void', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const txId = req.params['id'] as string;
    const voided = await voidTransaction(req.user!.uid, txId, req.body?.reason);
    res.json(voided);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === 'TRANSACTION_NOT_FOUND') {
      res.status(404).json({ error: 'TRANSACTION_NOT_FOUND', message: errorObj.message });
      return;
    }
    if (errorObj.code === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: errorObj.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to void transaction';
    res.status(400).json({ error: 'TRANSACTION_VOID_FAILED', message });
  }
});

// -------------------------------------------------------------------
// Category APIs
// -------------------------------------------------------------------
app.get('/api/categories', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const categories = await getCategories(req.user!.uid);
    res.json(categories);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve categories';
    res.status(500).json({ error: 'CATEGORIES_FETCH_FAILED', message });
  }
});

app.post('/api/categories', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cat = await createCategory(req.user!.uid, req.body);
    res.status(201).json(cat);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create category';
    res.status(400).json({ error: 'CATEGORY_CREATION_FAILED', message });
  }
});

app.put('/api/categories/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const catId = req.params['id'] as string;
    const updated = await updateCategory(req.user!.uid, catId, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update category';
    res.status(400).json({ error: 'CATEGORY_UPDATE_FAILED', message });
  }
});

// -------------------------------------------------------------------
// Counterparty APIs
// -------------------------------------------------------------------
app.get('/api/counterparties', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const counterparties = await getCounterparties(req.user!.uid);
    res.json(counterparties);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve counterparties';
    res.status(500).json({ error: 'COUNTERPARTIES_FETCH_FAILED', message });
  }
});

app.post('/api/counterparties', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cp = await createCounterparty(req.user!.uid, req.body);
    res.status(201).json(cp);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create counterparty';
    res.status(400).json({ error: 'COUNTERPARTY_CREATION_FAILED', message });
  }
});

app.put('/api/counterparties/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cpId = req.params['id'] as string;
    const updated = await updateCounterparty(req.user!.uid, cpId, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update counterparty';
    res.status(400).json({ error: 'COUNTERPARTY_UPDATE_FAILED', message });
  }
});

// -------------------------------------------------------------------
// Tag APIs
// -------------------------------------------------------------------
app.get('/api/tags', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tags = await getTags(req.user!.uid);
    res.json(tags);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve tags';
    res.status(500).json({ error: 'TAGS_FETCH_FAILED', message });
  }
});

app.post('/api/tags', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tag = await createTag(req.user!.uid, req.body);
    res.status(201).json(tag);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create tag';
    res.status(400).json({ error: 'TAG_CREATION_FAILED', message });
  }
});

app.put('/api/tags/:id', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tagId = req.params['id'] as string;
    const updated = await updateTag(req.user!.uid, tagId, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update tag';
    res.status(400).json({ error: 'TAG_UPDATE_FAILED', message });
  }
});

// ==========================================
// Slice 4: Dashboard & Reporting APIs
// ==========================================

/**
 * GET /api/reports/dashboard: Canonical dashboard metrics and reporting aggregations.
 */
app.get('/api/reports/dashboard', authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = (req.query['period'] as ReportingPeriodType) || 'current_month';
    const startDate = req.query['startDate'] as string | undefined;
    const endDate = req.query['endDate'] as string | undefined;
    const fyStartMonth = req.query['fyStartMonth'] ? parseInt(req.query['fyStartMonth'] as string, 10) : 4;

    const report = await getDashboardReport(req.user!.uid, {
      period,
      startDate,
      endDate,
      financialYearStartMonth: fyStartMonth,
    });
    res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate dashboard report';
    res.status(500).json({ error: 'DASHBOARD_REPORT_FAILED', message });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other non-API routes by serving the client SPA index.html
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'NOT_FOUND', message: `API endpoint ${req.path} not found.` });
    return;
  }

  const indexPath = join(browserDistFolder, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

/**
 * Start the server if this module is the main entry point
 */
const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain || process.env['PORT'] || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = app;
export default app;
