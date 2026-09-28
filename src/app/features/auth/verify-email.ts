import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-verify-email',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)] flex flex-col justify-center py-12 sm:px-6 lg:px-8 antialiased">
      <div class="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-[#A8752F]/15 border border-[var(--color-warning)]/30 text-[var(--color-warning)] flex items-center justify-center mb-4">
          <mat-icon class="text-[24px] w-6 h-6">mark_email_unread</mat-icon>
        </div>
        <h2 class="font-editorial text-3xl font-semibold text-[var(--color-ink)] tracking-tight">
          Verify Email Address
        </h2>
        <p class="mt-1 text-xs text-[var(--color-secondary)] uppercase tracking-widest font-mono">
          Security Gate Enforcement
        </p>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div class="bg-[var(--color-surface)] py-8 px-6 border border-[var(--color-border)] rounded-xl shadow-xs sm:px-10 text-center space-y-6">
          <div class="text-sm text-[var(--color-secondary)] leading-relaxed space-y-2">
            <p>
              A verification link was dispatched to:
            </p>
            <p class="font-mono text-sm font-semibold text-[var(--color-ink)] bg-[var(--color-canvas)] py-1.5 px-3 rounded border border-[var(--color-border)] inline-block">
              {{ authService.userEmail() || 'your email' }}
            </p>
            <p class="text-xs pt-2">
              Per security policy, Firestore Security Rules and the Node.js API enforce verified status before granting access to financial records.
            </p>
          </div>

          @if (feedbackMessage()) {
            <div class="p-3 rounded-md border text-xs font-medium"
              [class]="isSuccess() ? 'border-[var(--color-positive)]/30 bg-[#44785A]/10 text-[var(--color-positive)]' : 'border-[var(--color-warning)]/30 bg-[#A8752F]/10 text-[var(--color-warning)]'"
            >
              {{ feedbackMessage() }}
            </div>
          }

          <div class="space-y-3 pt-2">
            <button
              type="button"
              (click)="checkVerificationStatus()"
              [disabled]="isChecking()"
              class="w-full py-2.5 px-4 rounded-md bg-[var(--color-accent)] text-white text-xs font-semibold tracking-wider uppercase hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer flex items-center justify-center space-x-1"
            >
              @if (isChecking()) {
                <span>Checking Status...</span>
              } @else {
                <mat-icon class="text-[16px] w-4 h-4 mr-1">refresh</mat-icon>
                <span>I Have Verified My Email</span>
              }
            </button>

            <button
              type="button"
              (click)="resendVerification()"
              [disabled]="isResending()"
              class="w-full py-2 px-4 rounded-md bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] text-xs font-medium hover:bg-[var(--color-surface)] disabled:opacity-50 transition-colors cursor-pointer"
            >
              @if (isResending()) {
                <span>Sending link...</span>
              } @else {
                <span>Resend Verification Link</span>
              }
            </button>
          </div>

          <div class="pt-4 border-t border-[var(--color-border)] flex items-center justify-between text-xs text-[var(--color-secondary)]">
            <button
              type="button"
              (click)="themeService.toggleTheme()"
              class="hover:text-[var(--color-ink)] cursor-pointer"
            >
              Toggle Theme
            </button>
            <button
              type="button"
              (click)="onLogout()"
              class="text-[var(--color-negative)] hover:underline cursor-pointer"
            >
              Sign out / Change account
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class VerifyEmail {
  readonly authService = inject(AuthService);
  readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);

  readonly isChecking = signal<boolean>(false);
  readonly isResending = signal<boolean>(false);
  readonly feedbackMessage = signal<string>('');
  readonly isSuccess = signal<boolean>(false);

  async checkVerificationStatus(): Promise<void> {
    this.isChecking.set(true);
    this.feedbackMessage.set('');

    try {
      await this.authService.refreshUser();
      if (this.authService.isEmailVerified()) {
        this.isSuccess.set(true);
        this.feedbackMessage.set('Email confirmed! Redirecting to application shell...');
        setTimeout(() => {
          this.router.navigate(['/']);
        }, 800);
      } else {
        this.isSuccess.set(false);
        this.feedbackMessage.set('Email not verified yet. Please check your inbox or spam folder and click the link.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error refreshing verification status';
      this.isSuccess.set(false);
      this.feedbackMessage.set(message);
    } finally {
      this.isChecking.set(false);
    }
  }

  async resendVerification(): Promise<void> {
    this.isResending.set(true);
    this.feedbackMessage.set('');

    try {
      await this.authService.resendVerificationEmail();
      this.isSuccess.set(true);
      this.feedbackMessage.set('Verification link re-sent! Please check your inbox.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resend verification email';
      this.isSuccess.set(false);
      this.feedbackMessage.set(message);
    } finally {
      this.isResending.set(false);
    }
  }

  async onLogout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
