import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { PinLockService } from '../../core/security/pin-lock.service';

@Component({
  selector: 'app-more',
  imports: [ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-8 max-w-4xl select-none">
      <div class="border-b border-[var(--color-border)] pb-6">
        <span class="text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">Preferences & Security</span>
        <h2 class="font-editorial text-3xl font-semibold text-[var(--color-ink)] mt-1">
          Settings & Controls
        </h2>
        <p class="text-sm text-[var(--color-secondary)] mt-1">
          Manage local PIN application lock, visual appearance, and session security.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- 1. PIN Lock Configuration -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
          <div class="flex items-center space-x-2 border-b border-[var(--color-border)] pb-3">
            <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">pin</mat-icon>
            <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
              Application PIN Lock
            </h3>
          </div>

          <p class="text-xs text-[var(--color-secondary)] leading-relaxed">
            Configure a 4–8 digit PIN to quickly lock the application on unattended devices. PIN verifiers are salted and hashed on the server using PBKDF2-SHA256 and never readable by the browser.
          </p>

          <div class="text-xs font-mono">
            Status:
            @if (pinLock.isConfigured()) {
              <span class="text-[var(--color-positive)] font-semibold ml-1">Configured</span>
            } @else {
              <span class="text-[var(--color-warning)] font-semibold ml-1">Not Configured</span>
            }
          </div>

          @if (pinSuccessMessage()) {
            <div class="p-3 rounded-md border border-[var(--color-positive)]/30 bg-[#44785A]/10 text-xs text-[var(--color-positive)] font-medium">
              {{ pinSuccessMessage() }}
            </div>
          }

          @if (pinErrorMessage()) {
            <div class="p-3 rounded-md border border-[var(--color-negative)]/30 bg-[#A6534B]/10 text-xs text-[var(--color-negative)] font-medium">
              {{ pinErrorMessage() }}
            </div>
          }

          <form [formGroup]="pinForm" (submit)="onSetPin($event)" class="space-y-3 pt-2">
            <div>
              <label for="newPin" class="block text-xs font-medium text-[var(--color-secondary)] mb-1">
                New PIN (4–8 digits)
              </label>
              <input
                id="newPin"
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="8"
                formControlName="pin"
                placeholder="••••"
                class="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] text-sm tracking-widest focus:outline-none focus:border-[var(--color-accent)] font-mono"
              />
            </div>

            <div>
              <label for="confirmPin" class="block text-xs font-medium text-[var(--color-secondary)] mb-1">
                Confirm PIN
              </label>
              <input
                id="confirmPin"
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="8"
                formControlName="confirmPin"
                placeholder="••••"
                class="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] text-sm tracking-widest focus:outline-none focus:border-[var(--color-accent)] font-mono"
              />
            </div>

            <div class="flex items-center space-x-2 pt-2">
              <button
                type="submit"
                [disabled]="pinForm.invalid || isSubmittingPin()"
                class="px-4 py-2 rounded-md bg-[var(--color-accent)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
              >
                @if (isSubmittingPin()) {
                  <span>Saving...</span>
                } @else {
                  <span>{{ pinLock.isConfigured() ? 'Update PIN' : 'Save PIN' }}</span>
                }
              </button>

              @if (pinLock.isConfigured()) {
                <button
                  type="button"
                  (click)="pinLock.lockApp()"
                  class="px-4 py-2 rounded-md bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] text-xs font-medium hover:bg-[var(--color-surface)] cursor-pointer"
                >
                  Lock App Now
                </button>
              }
            </div>
          </form>
        </div>

        <!-- 2. Visual Theme & Session Details -->
        <div class="space-y-6">
          <!-- Theme Box -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
            <div class="flex items-center space-x-2 border-b border-[var(--color-border)] pb-3">
              <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">palette</mat-icon>
              <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                Visual Theme
              </h3>
            </div>

            <p class="text-xs text-[var(--color-secondary)] leading-relaxed">
              Toggle between Warm Paper (Light) and Night Ink (Dark) variants. Both themes share identical typography, spacing, and 6–8px geometry.
            </p>

            <div class="flex items-center space-x-3 pt-2">
              <button
                type="button"
                (click)="themeService.setTheme('light')"
                class="flex-1 py-2 px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer flex items-center justify-center space-x-2"
                [class]="themeService.theme() === 'light' ? 'border-[var(--color-accent)] bg-[var(--color-canvas)] text-[var(--color-ink)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-secondary)]'"
              >
                <mat-icon class="text-[16px] w-4 h-4">light_mode</mat-icon>
                <span>Warm Paper (Light)</span>
              </button>

              <button
                type="button"
                (click)="themeService.setTheme('dark')"
                class="flex-1 py-2 px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer flex items-center justify-center space-x-2"
                [class]="themeService.theme() === 'dark' ? 'border-[var(--color-accent)] bg-[var(--color-canvas)] text-[var(--color-ink)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-secondary)]'"
              >
                <mat-icon class="text-[16px] w-4 h-4">dark_mode</mat-icon>
                <span>Night Ink (Dark)</span>
              </button>
            </div>
          </div>

          <!-- Session & Identity Box -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
            <div class="flex items-center space-x-2 border-b border-[var(--color-border)] pb-3">
              <mat-icon class="text-[20px] w-5 h-5 text-[var(--color-accent)]">account_circle</mat-icon>
              <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                Session Control
              </h3>
            </div>

            <div class="space-y-2 text-xs">
              <div class="flex justify-between py-1 border-b border-[var(--color-border)]/50">
                <span class="text-[var(--color-secondary)]">User Email</span>
                <span class="font-mono text-[var(--color-ink)]">{{ authService.userEmail() }}</span>
              </div>
              <div class="flex justify-between py-1 border-b border-[var(--color-border)]/50">
                <span class="text-[var(--color-secondary)]">Verification</span>
                <span class="font-mono font-medium" [class]="authService.isEmailVerified() ? 'text-[var(--color-positive)]' : 'text-[var(--color-warning)]'">
                  {{ authService.isEmailVerified() ? 'Verified' : 'Unverified' }}
                </span>
              </div>
            </div>

            <div class="pt-2">
              <button
                type="button"
                (click)="onSignOut()"
                class="w-full py-2 px-4 rounded-md border border-[var(--color-negative)]/30 text-[var(--color-negative)] text-xs font-medium hover:bg-[#A6534B]/10 transition-colors cursor-pointer flex items-center justify-center space-x-1"
              >
                <mat-icon class="text-[16px] w-4 h-4 mr-1">logout</mat-icon>
                <span>Terminate Session (Sign Out)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class More {
  readonly authService = inject(AuthService);
  readonly themeService = inject(ThemeService);
  readonly pinLock = inject(PinLockService);
  private readonly router = inject(Router);

  readonly pinForm = new FormGroup({
    pin: new FormControl('', [Validators.required, Validators.pattern(/^\d{4,8}$/)]),
    confirmPin: new FormControl('', [Validators.required]),
  });

  readonly isSubmittingPin = signal<boolean>(false);
  readonly pinSuccessMessage = signal<string>('');
  readonly pinErrorMessage = signal<string>('');

  async onSetPin(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pinForm.invalid) return;

    const pin = this.pinForm.value.pin ?? '';
    const confirmPin = this.pinForm.value.confirmPin ?? '';

    if (pin !== confirmPin) {
      this.pinErrorMessage.set('PINs do not match.');
      return;
    }

    this.isSubmittingPin.set(true);
    this.pinSuccessMessage.set('');
    this.pinErrorMessage.set('');

    try {
      const ok = await this.pinLock.setPin(pin);
      if (ok) {
        this.pinSuccessMessage.set('PIN verifier updated securely on server.');
        this.pinForm.reset();
      } else {
        this.pinErrorMessage.set('Failed to update PIN. Ensure session is active.');
      }
    } catch {
      this.pinErrorMessage.set('An error occurred while saving PIN.');
    } finally {
      this.isSubmittingPin.set(false);
    }
  }

  async onSignOut(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
