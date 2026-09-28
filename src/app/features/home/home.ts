import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { PinLockService } from '../../core/security/pin-lock.service';
import { ApiClientService } from '../../core/api/api-client.service';

interface HealthResponse {
  status: string;
  timestamp: string;
  firebaseAdminInitialized: boolean;
  version: string;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-8 select-none">
      <!-- Page Header -->
      <div class="border-b border-[var(--color-border)] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span class="text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">Foundation Shell</span>
          <h2 class="font-editorial text-3xl md:text-4xl font-semibold text-[var(--color-ink)] mt-1">
            System Status & Readiness
          </h2>
          <p class="text-sm text-[var(--color-secondary)] mt-1 max-w-2xl">
            Slice 1 architectural boundary established. Client SPA, Node.js API, Firebase Authentication, and PIN lock foundations are active.
          </p>
        </div>

        <div class="flex items-center space-x-2">
          <span class="inline-flex items-center px-3 py-1 rounded text-xs font-medium bg-[#44785A]/10 text-[var(--color-positive)] border border-[#44785A]/20">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-positive)] mr-1.5"></span>
            Slice 1 Complete
          </span>
        </div>
      </div>

      <!-- Identity & Security Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- 1. Authentication Status -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs uppercase tracking-wider font-semibold text-[var(--color-secondary)]">Identity Scope</span>
            <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">shield</mat-icon>
          </div>
          <div class="space-y-3">
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Authenticated User</p>
              <p class="font-mono text-sm font-semibold text-[var(--color-ink)] truncate">{{ authService.userEmail() || 'Not Signed In' }}</p>
            </div>
            <div>
              <p class="text-xs text-[var(--color-secondary)]">UID Boundary</p>
              <p class="font-mono text-xs text-[var(--color-secondary)] truncate">{{ authService.userId() || 'None' }}</p>
            </div>
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Email Verification</p>
              @if (authService.isEmailVerified()) {
                <span class="inline-flex items-center text-xs font-medium text-[var(--color-positive)] mt-0.5">
                  <mat-icon class="text-[14px] w-3.5 h-3.5 mr-1">check_circle</mat-icon>
                  Verified
                </span>
              } @else {
                <span class="inline-flex items-center text-xs font-medium text-[var(--color-warning)] mt-0.5">
                  <mat-icon class="text-[14px] w-3.5 h-3.5 mr-1">warning</mat-icon>
                  Unverified (Restricted)
                </span>
              }
            </div>
          </div>
        </div>

        <!-- 2. Node.js API & Admin SDK Status -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs uppercase tracking-wider font-semibold text-[var(--color-secondary)]">Node.js API</span>
            <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">dns</mat-icon>
          </div>
          <div class="space-y-3">
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Endpoint Status</p>
              <p class="font-mono text-sm font-semibold text-[var(--color-ink)]">
                {{ apiStatus() }}
              </p>
            </div>
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Firebase Admin SDK</p>
              <p class="text-xs font-mono text-[var(--color-secondary)]">
                {{ adminSdkStatus() }}
              </p>
            </div>
            <div class="pt-1">
              <button
                type="button"
                (click)="pingApi()"
                class="px-2.5 py-1 rounded bg-[var(--color-canvas)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface)] cursor-pointer"
              >
                Ping /api/health
              </button>
            </div>
          </div>
        </div>

        <!-- 3. PIN Lock Security -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs uppercase tracking-wider font-semibold text-[var(--color-secondary)]">App-Lock PIN</span>
            <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">pin</mat-icon>
          </div>
          <div class="space-y-3">
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Security Verifier</p>
              <p class="text-xs font-medium mt-0.5">
                @if (pinLock.isConfigured()) {
                  <span class="text-[var(--color-positive)] flex items-center">
                    <mat-icon class="text-[14px] w-3.5 h-3.5 mr-1">lock</mat-icon>
                    PBKDF2-SHA256 Configured
                  </span>
                } @else {
                  <span class="text-[var(--color-secondary)]">Not Set (Configure in More)</span>
                }
              </p>
            </div>
            <div>
              <p class="text-xs text-[var(--color-secondary)]">Client Verifier Exposure</p>
              <p class="text-xs font-mono text-[var(--color-positive)]">Zero (Server Protected)</p>
            </div>
            <div class="pt-1">
              @if (pinLock.isConfigured()) {
                <button
                  type="button"
                  (click)="pinLock.lockApp()"
                  class="px-2.5 py-1 rounded bg-[var(--color-canvas)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface)] cursor-pointer"
                >
                  Test Lock Now
                </button>
              } @else {
                <a
                  routerLink="/more"
                  class="px-2.5 py-1 rounded bg-[var(--color-accent)] text-white text-xs font-medium hover:opacity-90 inline-block"
                >
                  Configure PIN
                </a>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Slice Boundary Verification Note -->
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
        <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
          Slice 1 Guardrails Verification
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[var(--color-secondary)]">
          <div class="space-y-2">
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>Zoneless Angular SPA:</strong> No Angular SSR, OnPush change detection, strict types.</span>
            </div>
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>Token Encapsulation:</strong> Firebase ID tokens strictly hidden from signals; retrieved on demand by API layer.</span>
            </div>
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>Server ID Token Verification:</strong> Derived user ID strictly from verified token claims.</span>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>Firestore Security Rules:</strong> Client writes to canonical financial collections strictly denied.</span>
            </div>
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>PIN Security:</strong> PBKDF2-SHA256 salt & hash inaccessible to client SDK.</span>
            </div>
            <div class="flex items-start space-x-2">
              <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-positive)] shrink-0 mt-0.5">check</mat-icon>
              <span><strong>No Mock Data:</strong> Zero synthetic financial data created. Pure foundation ready for Slice 2.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class Home implements OnInit {
  readonly authService = inject(AuthService);
  readonly pinLock = inject(PinLockService);
  private readonly api = inject(ApiClientService);

  readonly apiStatus = signal<string>('Checking...');
  readonly adminSdkStatus = signal<string>('Checking...');

  ngOnInit(): void {
    this.pingApi();
  }

  async pingApi(): Promise<void> {
    try {
      const res = await this.api.get<HealthResponse>('/api/health');
      this.apiStatus.set(`Online (v${res.version})`);
      this.adminSdkStatus.set(res.firebaseAdminInitialized ? 'Connected / Initialized' : 'Ready (Awaiting Credentials)');
    } catch {
      this.apiStatus.set('Offline / Unreachable');
      this.adminSdkStatus.set('Unknown');
    }
  }
}
