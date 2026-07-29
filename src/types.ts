/**
 * Shared Type Definitions for the SSO Application (sasso)
 */

export interface UserProfile {
  uid: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  createdAt: string;
  isEmailVerified?: boolean;
  emailVerifiedAt?: string;
  verificationDeadline?: string; // 7-day deadline from creation
  recoveryCode?: string; // Unique Master Recovery Code for account recovery
  authenticators?: RegisteredPasskey[];
  activeSessions?: UserActiveSession[];
}

export interface VerificationCodeRecord {
  email: string;
  code: string;
  expiresAt: number;
  createdAt: string;
}

export interface ClientApp {
  id: string;
  name: string;
  description: string;
  logo: string;
  url: string;
  redirectUri: string;
  clientSecret: string;
  accentColor: string;
  ownerEmail?: string;
  isFirstParty?: boolean;
}

export interface AuthCode {
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  expiresAt: number;
  used: boolean;
  accessType?: 'offline' | 'online';
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

export interface StoredRefreshToken {
  id: string;
  token: string;
  uid: string;
  email: string;
  clientId: string;
  clientName?: string;
  tokenType?: 'central_session' | 'client_app';
  createdAt: string;
  expiresAt: number;
}

export interface AppSession {
  appToken: string;
  user: UserProfile;
  loggedInAt: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  protocol: 'OIDC/OAuth2' | 'postMessage' | 'JWT Verify' | 'Central Auth';
  type: 'request' | 'response' | 'event' | 'success' | 'error';
  source: string;
  destination: string;
  message: string;
  details?: any;
}

export interface RegisteredPasskey {
  credentialID: string;
  credentialPublicKey?: string;
  username: string;
  email?: string;
  userId?: string;
  deviceName: string;
  authenticatorType: string;
  transports: string[];
  createdAt: string;
  lastUsedAt?: string;
  counter: number;
}

export interface QrLoginSession {
  qrSessionId: string;
  status: 'pending' | 'approved' | 'expired' | 'cancelled';
  qrUrl: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
  userAgent?: string;
  userEmail?: string;
  token?: string;
  user?: UserProfile;
}

export interface UserActiveSession {
  sessionId: string;
  username: string;
  email?: string;
  deviceName: string;
  userAgent: string;
  ip: string;
  loginType: 'passkey' | 'qr_code' | 'sso';
  createdAt: string;
  lastActiveAt: string;
  isCurrent?: boolean;
}

