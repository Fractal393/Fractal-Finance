import { Request, Response, NextFunction } from 'express';
import { getFirebaseAdmin } from './firebase-admin.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  mfaSecondFactor?: unknown;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Middleware that validates the Firebase ID token from the Authorization header.
 * Derives user ID strictly from the verified token.
 */
export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header with Bearer token.',
    });
    return;
  }

  const token = authHeader.split('Bearer ')[1].trim();
  const { auth, initialized } = getFirebaseAdmin();

  if (!initialized || !auth) {
    res.status(503).json({
      error: 'FIREBASE_ADMIN_UNINITIALIZED',
      message: 'Firebase Admin SDK is not initialized on the server.',
    });
    return;
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    
    // Explicitly derive user from verified token claims only
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified === true,
      mfaSecondFactor: decodedToken.firebase?.sign_in_second_factor,
    };

    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: `Failed to verify Firebase ID token: ${message}`,
    });
  }
}

/**
 * Middleware ensuring the authenticated user has verified their email.
 */
export function requireVerifiedEmail(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
    return;
  }

  if (!req.user.emailVerified) {
    res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Email verification is required before accessing protected financial services.',
    });
    return;
  }

  next();
}
