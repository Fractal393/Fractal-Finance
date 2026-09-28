# Personal Finance OS — Technical Architecture

## 1. Architectural Decision

V1 uses a **modular full-stack web application** built around the environment we will use to develop it:

- Frontend: Angular + TypeScript
- Server/runtime: Node.js + TypeScript
- Database: Cloud Firestore
- Authentication: Firebase Authentication
- Higher-security authentication: Firebase Authentication with Identity Platform when MFA is enabled
- Server-side privileged operations: Node.js server code / Firebase Admin SDK or Cloud Functions as appropriate
- Local development: Firebase Emulator Suite where practical
- Development environment: Google AI Studio Build Mode + Gemini coding agent
- Source control: GitHub

The application starts as a single-user product, but every persistent financial record is user-scoped from the beginning so multi-user support can be added without redesigning ownership.

## 2. Why This Architecture

The product's hard problems are financial correctness, auditability, historical reconstruction, import quality, privacy and security—not distributed systems.

Angular + Node.js + Firebase is preferred because it matches the actual Google AI Studio environment and keeps the application in one TypeScript ecosystem. Firestore gives us managed persistence and atomic transactions/batched writes, while Firebase Authentication gives us the identity layer. Firebase's web authentication supports email/password and other providers, and MFA/TOTP is available when Firebase Authentication is upgraded with Identity Platform.

We will **not** introduce microservices, Kafka, Redis, a separate analytics warehouse, or an ORM in V1.

## 3. Runtime Shape

```text
Browser
  |
  | HTTPS
  v
Angular application
  |
  | Firebase client SDK / authenticated requests
  +----------------------------+
  |                            |
v                            v
Firebase Auth             Firestore
  |                            |
  |                            +--> accounts
  |                            +--> transactions
  |                            +--> categories
  |                            +--> investments
  |                            +--> assets
  |                            +--> taxes
  |                            +--> debts / receivables
  |                            +--> imports
  |                            +--> audit
  |
  v
Authenticated user context

Server-side Node.js / Cloud Functions
  |
  +--> privileged financial operations
  +--> connector integrations
  +--> import parsing/normalization
  +--> sensitive calculations/workflows where appropriate
  +--> scheduled/triggered derived-data maintenance where explicitly needed
```

Client-side Firestore operations must obey Firestore Security Rules. Server-side Admin SDK operations bypass Firestore Security Rules, so server-side code must enforce authorization and least privilege independently.

## 4. Application Boundaries

### Identity
Owns: Firebase Authentication identity, email verification, MFA enrollment/challenge, account security settings, app-lock/PIN metadata.

### Accounts
Owns: bank accounts, savings/current accounts, the single canonical Cash account, opening balances, balance snapshots, reconciliation.

### Transactions
Owns: canonical transactions, transaction allocations, internal transfers, counterparties, tags, recurring transaction templates, edit/void lifecycle.

### Income
Owns: gross income records, deductions, gross-to-net relationships, income-linked cash receipts.

### Investments
Owns: aggregate investment positions/categories, contributions, valuations, realized gains, unrealized gains, dividends, fees, investment taxes.
Individual security-level holdings/trading are not V1.

### Assets
Owns: non-financial assets, acquisitions, valuation history, sale/disposal records.

### Taxes
Owns: tax withheld, direct tax payments, tax refunds, net tax calculation.

### Debts / Receivables
Owns: borrowed money / liabilities, debt principal and payments, money lent to others, receivables, repayments received.

### Imports
Owns: import source metadata, import batches, raw/imported transactions, normalization, duplicate detection, review/approval state, connector metadata.
Imported rows never become canonical financial records merely because they were parsed.

### Categorization
Owns: user categories, category hierarchy, tags, counterparty patterns, categorization rules, trusted rules.

### Reporting
Owns queries and derived views for dashboard, cash flow, savings, savings rate, net worth history, financial health metrics, lifetime summary, financial activity, reporting periods. Derived reporting values are not the financial source of truth.

### Audit
Owns: append-oriented audit records, actor/user, timestamp, entity type/id, action, before/after snapshots where appropriate, request/correlation identifier.

## 5. Firestore Data Architecture
Use a top-level user boundary for all user-owned financial data: `users/{userId}/...`

Do not store an entire transaction history inside one user document. Do not create unbounded arrays for transactions, audit logs, tags, allocations or valuations. For high-volume child data, queryable collections are preferred over ever-growing arrays.
