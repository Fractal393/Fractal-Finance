import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const verifiedEmailGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (authService.isEmailVerified()) {
    return true;
  }

  // Authenticated but email not yet verified: redirect to verify-email view
  return router.createUrlTree(['/verify-email']);
};
