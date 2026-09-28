import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PinLockService } from '../../core/security/pin-lock.service';

@Component({
  selector: 'app-pin-lock-overlay',
  imports: [ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pinLock.isLocked()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-canvas)]/95 backdrop-blur-sm p-4">
        <div class="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
          <div class="w-12 h-12 mx-auto rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center mb-4">
            <mat-icon class="text-[24px] w-6 h-6 text-[var(--color-accent)]">lock</mat-icon>
          </div>

          <h2 class="font-editorial text-xl font-semibold text-[var(--color-ink)] mb-1">Application Locked</h2>
          <p class="text-xs text-[var(--color-secondary)] mb-6">Enter your security PIN to resume session</p>

          <form (submit)="onSubmit($event)" class="space-y-4">
            <div>
              <input
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="8"
                [formControl]="pinControl"
                placeholder="••••"
                class="w-full text-center text-2xl tracking-[0.4em] py-2.5 px-4 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            @if (errorMessage()) {
              <p class="text-xs text-[var(--color-negative)] font-medium">{{ errorMessage() }}</p>
            }

            <button
              type="submit"
              [disabled]="pinControl.invalid || isVerifying()"
              class="w-full py-2.5 px-4 rounded-md bg-[var(--color-accent)] text-white text-xs font-semibold tracking-wide hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer flex items-center justify-center space-x-1"
            >
              @if (isVerifying()) {
                <span>Verifying...</span>
              } @else {
                <span>Unlock Application</span>
              }
            </button>
          </form>
        </div>
      </div>
    }
  `,
})
export class PinLockOverlay {
  readonly pinLock = inject(PinLockService);
  readonly pinControl = new FormControl('', [Validators.required, Validators.minLength(4), Validators.maxLength(8)]);
  readonly errorMessage = signal<string>('');
  readonly isVerifying = signal<boolean>(false);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pinControl.invalid) return;

    this.errorMessage.set('');
    this.isVerifying.set(true);

    try {
      const pin = this.pinControl.value ?? '';
      const success = await this.pinLock.verifyPin(pin);
      if (success) {
        this.pinControl.reset();
      } else {
        this.errorMessage.set('Incorrect PIN. Please try again.');
      }
    } catch {
      this.errorMessage.set('Verification failed. Please check connection.');
    } finally {
      this.isVerifying.set(false);
    }
  }
}
