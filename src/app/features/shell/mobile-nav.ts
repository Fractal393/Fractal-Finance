import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-mobile-nav',
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex items-center justify-around px-2 z-40 select-none">
      <!-- 1. Home -->
      <a
        routerLink="/"
        routerLinkActive="text-[var(--color-accent)] font-semibold"
        [routerLinkActiveOptions]="{ exact: true }"
        class="flex flex-col items-center justify-center flex-1 py-1 text-[var(--color-secondary)] hover:text-[var(--color-ink)] transition-colors"
      >
        <mat-icon class="text-[20px] w-5 h-5">home</mat-icon>
        <span class="text-[10px] mt-0.5 tracking-tight">Home</span>
      </a>

      <!-- 2. Transactions -->
      <a
        routerLink="/transactions"
        routerLinkActive="text-[var(--color-accent)] font-semibold"
        class="flex flex-col items-center justify-center flex-1 py-1 text-[var(--color-secondary)] hover:text-[var(--color-ink)] transition-colors"
      >
        <mat-icon class="text-[20px] w-5 h-5">receipt_long</mat-icon>
        <span class="text-[10px] mt-0.5 tracking-tight">Transactions</span>
      </a>

      <!-- Central + Quick Add Action Placeholder -->
      <div class="flex items-center justify-center px-1">
        <button
          type="button"
          (click)="quickAddClicked.emit()"
          title="Quick Add Action"
          class="w-11 h-11 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center shadow-sm hover:opacity-90 active:scale-95 transition-transform cursor-pointer"
        >
          <mat-icon class="text-[24px] w-6 h-6">add</mat-icon>
        </button>
      </div>

      <!-- 3. Accounts -->
      <a
        routerLink="/accounts"
        routerLinkActive="text-[var(--color-accent)] font-semibold"
        class="flex flex-col items-center justify-center flex-1 py-1 text-[var(--color-secondary)] hover:text-[var(--color-ink)] transition-colors"
      >
        <mat-icon class="text-[20px] w-5 h-5">account_balance</mat-icon>
        <span class="text-[10px] mt-0.5 tracking-tight">Accounts</span>
      </a>

      <!-- 4. Investments -->
      <a
        routerLink="/investments"
        routerLinkActive="text-[var(--color-accent)] font-semibold"
        class="flex flex-col items-center justify-center flex-1 py-1 text-[var(--color-secondary)] hover:text-[var(--color-ink)] transition-colors"
      >
        <mat-icon class="text-[20px] w-5 h-5">trending_up</mat-icon>
        <span class="text-[10px] mt-0.5 tracking-tight">Investments</span>
      </a>

      <!-- 5. More -->
      <a
        routerLink="/more"
        routerLinkActive="text-[var(--color-accent)] font-semibold"
        class="flex flex-col items-center justify-center flex-1 py-1 text-[var(--color-secondary)] hover:text-[var(--color-ink)] transition-colors"
      >
        <mat-icon class="text-[20px] w-5 h-5">more_horiz</mat-icon>
        <span class="text-[10px] mt-0.5 tracking-tight">More</span>
      </a>
    </nav>
  `,
})
export class MobileNav {
  readonly quickAddClicked = output<void>();
}
