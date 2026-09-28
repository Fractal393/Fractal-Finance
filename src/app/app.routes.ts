import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { Shell } from './features/shell/shell';
import { Home } from './features/home/home';
import { Transactions } from './features/transactions/transactions';
import { Accounts } from './features/accounts/accounts';
import { InvestmentsPlaceholder } from './features/investments/investments-placeholder';
import { More } from './features/more/more';
import { Login } from './features/auth/login';
import { Register } from './features/auth/register';
import { VerifyEmail } from './features/auth/verify-email';

export const routes: Routes = [
  // Public Auth Views
  {
    path: 'login',
    component: Login,
  },
  {
    path: 'register',
    component: Register,
  },
  {
    path: 'verify-email',
    component: VerifyEmail,
  },

  // Protected App Shell Routes
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        component: Home,
      },
      {
        path: 'transactions',
        component: Transactions,
      },
      {
        path: 'accounts',
        component: Accounts,
      },
      {
        path: 'investments',
        component: InvestmentsPlaceholder,
      },
      {
        path: 'more',
        component: More,
      },
    ],
  },

  // Fallback
  {
    path: '**',
    redirectTo: '',
  },
];
