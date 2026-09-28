import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { PinLockService } from '../../core/security/pin-lock.service';
import { QuickAddService } from '../../core/transactions/quick-add.service';

@Component({
  selector: 'app-desktop-header',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="h-16 px-8 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between select-none">
      <div class="flex items-center space-x-3">
        <span class="text-xs uppercase tracking-widest text-[var(--color-secondary)] font-medium">Session</span>
        <span class="text-xs font-mono text-[var(--color-ink)] px-2 py-0.5 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]">
          {{ authService.userEmail() || 'Guest' }}
        </span>

        @if (authService.isAuthenticated()) {
          @if (authService.isEmailVerified()) {
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#44785A]/10 text-[var(--color-positive)] border border-[#44785A]/20">
              Verified
            </span>
          } @else {
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#A8752F]/10 text-[var(--color-warning)] border border-[#A8752F]/20">
              Unverified Email
            </span>
          }
        }
      </div>

      <div class="flex items-center space-x-3">
        <!-- Quick Add Action Button (Desktop) -->
        <button
          type="button"
          (click)="quickAdd.open()"
          class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium tracking-wide bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors shadow-xs cursor-pointer"
        >
          <mat-icon class="text-[18px] w-[18px] h-[18px]">add</mat-icon>
          <span>Quick Add</span>
        </button>

        <!-- App Lock Button -->
        @if (pinLock.isConfigured()) {
          <button
            type="button"
            (click)="pinLock.lockApp()"
            title="Lock Application"
            class="p-2 rounded-md text-[var(--color-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas)] border border-transparent hover:border-[var(--color-border)] transition-colors cursor-pointer"
          >
            <mat-icon class="text-[20px] w-5 h-5">lock_outline</mat-icon>
          </button>
        }

        <!-- Theme Toggle Button -->
        <button
          type="button"
          (click)="themeService.toggleTheme()"
          [title]="themeService.theme() === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'"
          class="p-2 rounded-md text-[var(--color-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas)] border border-transparent hover:border-[var(--color-border)] transition-colors cursor-pointer"
        >
          <mat-icon class="text-[20px] w-5 h-5">
            {{ themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}
          </mat-icon>
        </button>

        <!-- Logout Action -->
        @if (authService.isAuthenticated()) {
          <button
            type="button"
            (click)="onLogout()"
            title="Sign out"
            class="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--color-secondary)] hover:text-[var(--color-negative)] hover:bg-[var(--color-canvas)] border border-transparent hover:border-[var(--color-border)] transition-colors cursor-pointer"
          >
            <mat-icon class="text-[18px] w-[18px] h-[18px]">logout</mat-icon>
            <span>Exit</span>
          </button>
        }
      </div>
    </header>
  `,
})
export class DesktopHeader {
  readonly authService = inject(AuthService);
  readonly themeService = inject(ThemeService);
  readonly pinLock = inject(PinLockService);
  readonly quickAdd = inject(QuickAddService);
  private readonly router = inject(Router);

  async onLogout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
