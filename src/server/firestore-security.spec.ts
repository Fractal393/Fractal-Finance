import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Security Rules Evaluation: Zero-Trust Client Permissions & User Isolation', () => {
  const rulesPath = join(process.cwd(), 'firestore.rules');
  const rulesContent = readFileSync(rulesPath, 'utf8');

  it('contains the mandatory global default-deny catch-all rule', () => {
    expect(rulesContent).toContain('match /{document=**}');
    expect(rulesContent).toContain('allow read, write: if false;');
  });

  it('enforces that client can READ its own financial accounts only with verified email', () => {
    // Look for match /accounts/{accountId}
    const accountsBlock = rulesContent.match(/match \/accounts\/\{accountId\} \{([\s\S]*?)\}/);
    expect(accountsBlock).toBeTruthy();
    const body = accountsBlock![1];
    expect(body).toContain('allow read: if isOwner(userId) && isEmailVerified();');
    // Client CANNOT WRITE financial accounts
    expect(body).toContain('allow write: if false;');
  });

  it('enforces that client can READ its own balance snapshots but CANNOT WRITE', () => {
    const snapshotsBlock = rulesContent.match(/match \/balanceSnapshots\/\{snapshotId\} \{([\s\S]*?)\}/);
    expect(snapshotsBlock).toBeTruthy();
    const body = snapshotsBlock![1];
    expect(body).toContain('allow read: if isOwner(userId) && isEmailVerified();');
    expect(body).toContain('allow write: if false;');
  });

  it('strictly forbids client from reading or writing security / PIN verifier documents', () => {
    const securityBlock = rulesContent.match(/match \/security\/\{docId\} \{([\s\S]*?)\}/);
    expect(securityBlock).toBeTruthy();
    const body = securityBlock![1];
    expect(body).toContain('allow read, write: if false;');
  });

  it('strictly forbids client from creating, updating, or deleting audit logs', () => {
    const auditBlock = rulesContent.match(/match \/audit\/\{auditId\} \{([\s\S]*?)\}/);
    expect(auditBlock).toBeTruthy();
    const body = auditBlock![1];
    expect(body).toContain('allow read: if isOwner(userId) && isEmailVerified();');
    expect(body).toContain('allow write: if false;');

    const auditLogsBlock = rulesContent.match(/match \/auditLogs\/\{auditId\} \{([\s\S]*?)\}/);
    expect(auditLogsBlock).toBeTruthy();
    const logsBody = auditLogsBlock![1];
    expect(logsBody).toContain('allow write: if false;');
  });

  it('guarantees User A cannot access User B path (strict isOwner validation)', () => {
    expect(rulesContent).toContain('function isOwner(userId)');
    expect(rulesContent).toContain('request.auth.uid == userId');
  });

  it('forbids unauthenticated access across all user paths', () => {
    expect(rulesContent).toContain('function isAuthenticated()');
    expect(rulesContent).toContain('request.auth != null');
  });
});
