import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)] flex flex-col justify-center py-12 sm:px-6 lg:px-8 antialiased">
      <div class="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div class="w-12 h-12 mx-auto rounded bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-lg tracking-wider mb-4">
          FF
        </div>
        <h2 class="font-editorial text-3xl font-semibold text-[var(--color-ink)] tracking-tight">
          Register Identity
        </h2>
        <p class="mt-1 text-xs text-[var(--color-secondary)] uppercase tracking-widest font-mono">
          Private User Boundary Setup
        </p>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div class="bg-[var(--color-surface)] py-8 px-6 border border-[var(--color-border)] rounded-xl shadow-xs sm:px-10">
          <div class="mb-6 border-b border-[var(--color-border)] pb-3 flex items-center justify-between">
            <h3 class="font-editorial text-xl font-semibold text-[var(--color-ink)]">Create Account</h3>
            <button
              type="button"
              (click)="themeService.toggleTheme()"
              class="p-1 rounded text-[var(--color-secondary)] hover:text-[var(--color-ink)] cursor-pointer"
              title="Toggle Theme"
            >
              <mat-icon class="text-[18px] w-[18px] h-[18px]">
                {{ themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}
              </mat-icon>
            </button>
          </div>

          @if (!authService.isConfigured()) {
            <div class="mb-6 p-4 rounded-md border border-[var(--color-warning)]/30 bg-[#A8752F]/10 text-xs text-[var(--color-warning)] space-y-1">
              <p class="font-semibold flex items-center space-x-1">
                <mat-icon class="text-[16px] w-4 h-4">info</mat-icon>
                <span>Firebase Configuration Required</span>
              </p>
              <p>Configure Firebase keys in <code class="font-mono text-[11px]">src/environments/environment.ts</code> to enable live registration.</p>
            </div>
          }

          @if (errorMessage()) {
            <div class="mb-6 p-3 rounded-md border border-[var(--color-negative)]/30 bg-[#A6534B]/10 text-xs text-[var(--color-negative)] font-medium">
              {{ errorMessage() }}
            </div>
          }

          <form [formGroup]="form" (submit)="onSubmit($event)" class="space-y-4">
            <div>
              <label for="email" class="block text-xs font-medium text-[var(--color-secondary)] uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                autocomplete="email"
                formControlName="email"
                placeholder="user@domain.com"
                class="w-full px-3.5 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>

            <div>
              <label for="password" class="block text-xs font-medium text-[var(--color-secondary)] uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autocomplete="new-password"
                formControlName="password"
                placeholder="At least 6 characters"
                class="w-full px-3.5 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>

            <div>
              <label for="confirmPassword" class="block text-xs font-medium text-[var(--color-secondary)] uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autocomplete="new-password"
                formControlName="confirmPassword"
                placeholder="Confirm password"
                class="w-full px-3.5 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>

            <button
              type="submit"
              [disabled]="form.invalid || isSubmitting()"
              class="w-full mt-2 py-2.5 px-4 rounded-md bg-[var(--color-accent)] text-white text-xs font-semibold tracking-wider uppercase hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer flex items-center justify-center space-x-2"
            >
              @if (isSubmitting()) {
                <span>Creating Account...</span>
              } @else {
                <span>Register & Continue</span>
              }
            </button>
          </form>

          <div class="mt-6 pt-5 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-secondary)]">
            <span>Already have an account?</span>
            <a routerLink="/login" class="ml-1 text-[var(--color-accent)] font-medium hover:underline">
              Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class Register {
  readonly authService = inject(AuthService);
  readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);

  readonly form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(6)]),
    confirmPassword: new FormControl('', [Validators.required]),
  });

  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string>('');

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.invalid) return;

    const email = this.form.value.email ?? '';
    const password = this.form.value.password ?? '';
    const confirmPassword = this.form.value.confirmPassword ?? '';

    if (password !== confirmPassword) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      await this.authService.register(email, password);
      this.router.navigate(['/verify-email']);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      this.errorMessage.set(message);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
