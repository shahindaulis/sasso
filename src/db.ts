import dotenv from 'dotenv';
dotenv.config();

import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, query, where, getDocs, deleteDoc, collectionGroup, deleteField } from 'firebase/firestore';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UserProfile, ClientApp, AuthCode, StoredRefreshToken, VerificationCodeRecord } from './types';

// In-memory fallback database just in case of configuration delay
const localDb = {
  users: new Map<string, any>(),
  authCodes: new Map<string, AuthCode>(),
  challenges: new Map<string, any>(),
  authenticators: new Map<string, any>(),
  authorizedApps: new Map<string, any>(),
  refreshTokens: new Map<string, StoredRefreshToken>(),
  verificationCodes: new Map<string, VerificationCodeRecord>(),
  qrSessions: new Map<string, any>(),
  activeSessions: new Map<string, any>(),
  apps: [] as ClientApp[],
};

// Default bootstrap apps
export const defaultApps: ClientApp[] = [];

const APPS_FILE = path.join(process.cwd(), 'client_apps.json');
const LEGACY_APPS_FILE = path.join(process.cwd(), 'src', 'client_apps.json');
const REFRESH_TOKENS_FILE = path.join(process.cwd(), 'refresh_tokens.json');

let isRealFirebase = false;
let db: any = null;

// Graceful Firebase client initialization
let firebaseConfig: any = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('🔥 sasso - Found firebase-applet-config.json! Loading parameters.');
  }
} catch (e) {
  // Ignore filesystem check issues
}

const firebaseApiKey = firebaseConfig?.apiKey || process.env.FIREBASE_API_KEY || '';
const firebaseProjectId = firebaseConfig?.projectId || process.env.FIREBASE_PROJECT_ID || '';

if (firebaseApiKey && firebaseProjectId) {
  try {
    const config = {
      apiKey: firebaseApiKey,
      projectId: firebaseProjectId,
      authDomain: firebaseConfig?.authDomain || `${firebaseProjectId}.firebaseapp.com`,
      storageBucket: firebaseConfig?.storageBucket || `${firebaseProjectId}.appspot.com`,
    };
    const app = getApps().length === 0 ? initializeApp(config) : getApp();
    db = getFirestore(app);
    isRealFirebase = true;
    console.log('🔥 sasso - Real Firestore connected successfully!');
  } catch (error) {
    console.error('❌ sasso - Failed to initialize Firebase client SDK. Falling back to Sandbox mode.', error);
  }
} else {
  console.log('⚠️ sasso - FIREBASE_API_KEY and FIREBASE_PROJECT_ID not set. Running in Local Sandbox Storage.');
}

export function isUsingFirebase(): boolean {
  return isRealFirebase;
}

// Client Apps Management (Using sasso_client_apps)
export async function getClientApps(): Promise<ClientApp[]> {
  if (isRealFirebase && db) {
    try {
      const q = query(collection(db, 'sasso_client_apps'));
      const snap = await getDocs(q);
      const apps: ClientApp[] = [];
      snap.forEach(doc => {
        apps.push(doc.data() as ClientApp);
      });
      
      // Seed initial apps from client_apps.json if Firestore sasso_client_apps is empty
      if (apps.length === 0) {
        let localApps: ClientApp[] = [];
        try {
          if (fs.existsSync(APPS_FILE)) {
            localApps = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
          } else if (fs.existsSync(LEGACY_APPS_FILE)) {
            localApps = JSON.parse(fs.readFileSync(LEGACY_APPS_FILE, 'utf8'));
          }
        } catch (e) {
          console.error('Error reading fallback local file during seed:', e);
        }
        
        if (localApps.length > 0) {
          for (const app of localApps) {
            await setDoc(doc(db, 'sasso_client_apps', app.id), app);
            apps.push(app);
          }
          console.log(`🔥 sasso - Seeded ${localApps.length} apps from local file to Firestore.`);
        }
      }
      return apps;
    } catch (err) {
      console.error('Error fetching client apps from Firestore, falling back:', err);
    }
  }

  // Local fallback
  try {
    if (fs.existsSync(APPS_FILE)) {
      return JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
    } else if (fs.existsSync(LEGACY_APPS_FILE)) {
      const legacyContent = fs.readFileSync(LEGACY_APPS_FILE, 'utf8');
      fs.writeFileSync(APPS_FILE, legacyContent, 'utf8');
      return JSON.parse(legacyContent);
    }
  } catch (err) {
    console.error('Error reading apps file:', err);
  }
  return localDb.apps;
}

export async function registerClientApp(app: ClientApp): Promise<ClientApp[]> {
  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_client_apps', app.id), app);
      return await getClientApps();
    } catch (err) {
      console.error('Error saving app to Firestore, falling back:', err);
    }
  }

  const apps = await getClientApps();
  apps.push(app);
  localDb.apps = apps;
  try {
    fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving apps file:', err);
  }
  return apps;
}

export async function deleteClientApp(appId: string): Promise<ClientApp[]> {
  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_client_apps', appId));
      return await getClientApps();
    } catch (err) {
      console.error('Error deleting app from Firestore, falling back:', err);
    }
  }

  let apps = await getClientApps();
  apps = apps.filter(a => a.id !== appId);
  localDb.apps = apps;
  try {
    fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving apps file:', err);
  }
  return apps;
}

// Helper function to generate Master Recovery Code
export function generateRecoveryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `REC-${part(4)}-${part(4)}-${part(4)}`;
}

// User Profile Management (Using sasso_users)
export async function registerUser(username: string, avatarUrl?: string): Promise<UserProfile> {
  const usernameLower = username.toLowerCase().trim();
  const existingUser = await getUserProfile(usernameLower);
  if (existingUser) {
    return existingUser; // Prevent creating duplicate accounts
  }

  const uid = 'user_' + Math.random().toString(36).substring(2, 11);
  const nowMs = Date.now();
  const deadlineMs = nowMs + 7 * 24 * 60 * 60 * 1000; // 7 days verification deadline
  const userDoc: UserProfile = {
    uid,
    username: usernameLower,
    avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${usernameLower}`,
    createdAt: new Date(nowMs).toISOString(),
    isEmailVerified: false,
    verificationDeadline: new Date(deadlineMs).toISOString(),
    recoveryCode: generateRecoveryCode()
  };

  if (isRealFirebase && db) {
    try {
      const userRef = doc(db, 'sasso_users', usernameLower);
      await setDoc(userRef, userDoc);
      return { ...userDoc, authenticators: [] };
    } catch (err: any) {
      console.error('Error in Firestore registerUser:', err);
      throw err;
    }
  } else {
    localDb.users.set(usernameLower, userDoc);
    return { ...userDoc, authenticators: [] };
  }
}

export async function getUserProfile(identifier: string): Promise<UserProfile | null> {
  if (!identifier) return null;
  const cleanId = identifier.toLowerCase().trim();
  let user: UserProfile | null = null;

  if (isRealFirebase && db) {
    try {
      // 1. Direct doc lookup by username
      const userRef = doc(db, 'sasso_users', cleanId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        user = userSnap.data() as UserProfile;
      } else {
        // 2. Query by username or email or uid
        const qUser = query(collection(db, 'sasso_users'), where('username', '==', cleanId));
        let snap = await getDocs(qUser);
        if (snap.empty) {
          const qEmail = query(collection(db, 'sasso_users'), where('email', '==', cleanId));
          snap = await getDocs(qEmail);
        }
        if (snap.empty) {
          const qUid = query(collection(db, 'sasso_users'), where('uid', '==', cleanId));
          snap = await getDocs(qUid);
        }
        // Fallback: If cleanId is an email address, try lookup by the email username prefix
        if (snap.empty && cleanId.includes('@')) {
          const prefix = cleanId.split('@')[0];
          const prefixSnap = await getDoc(doc(db, 'sasso_users', prefix));
          if (prefixSnap.exists()) {
            user = prefixSnap.data() as UserProfile;
            if (!user.email) {
              user.email = cleanId;
              setDoc(doc(db, 'sasso_users', user.username), { email: cleanId }, { merge: true }).catch(() => {});
            }
          }
        } else if (!snap.empty) {
          user = snap.docs[0].data() as UserProfile;
        }
      }
    } catch (err) {
      console.error('Error in Firestore getUserProfile:', err);
    }
  }

  if (!user) {
    for (const u of localDb.users.values()) {
      const uEmail = u.email ? u.email.toLowerCase().trim() : '';
      const uName = u.username ? u.username.toLowerCase().trim() : '';
      const emailPrefix = uEmail.includes('@') ? uEmail.split('@')[0] : '';
      const inputPrefix = cleanId.includes('@') ? cleanId.split('@')[0] : cleanId;
      if (
        uName === cleanId ||
        uEmail === cleanId ||
        u.uid === cleanId ||
        uName === inputPrefix ||
        (emailPrefix && emailPrefix === inputPrefix)
      ) {
        user = u;
        if (cleanId.includes('@') && !u.email) {
          u.email = cleanId;
        }
        break;
      }
    }
  }

  if (!user) return null;

  // Fill default email verification fields if missing
  if (user.isEmailVerified === undefined) {
    user.isEmailVerified = false;
  }
  if (!user.verificationDeadline) {
    const createdMs = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();
    user.verificationDeadline = new Date(createdMs + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  // Ensure user has a Master Recovery Code
  if (!user.recoveryCode) {
    user.recoveryCode = generateRecoveryCode();
    if (isRealFirebase && db) {
      setDoc(doc(db, 'sasso_users', user.username), { recoveryCode: user.recoveryCode }, { merge: true }).catch(err => console.error(err));
    }
  }

  user.authenticators = await getUserAuthenticators(user.username);
  user.activeSessions = await getUserActiveSessions(user.username);

  // Check 7-day expiration for unverified accounts
  if (!user.isEmailVerified && user.verificationDeadline) {
    const deadlineMs = new Date(user.verificationDeadline).getTime();
    if (Date.now() > deadlineMs) {
      console.warn(`⚠️ User ${user.username} account expired (unverified after 7 days). Automatically deleting...`);
      await deleteUserAccount(user.username);
      return null;
    }
  }

  return user;
}

export async function findUserByRecoveryCode(codeOrIdentifier: string, inputCode?: string): Promise<UserProfile | null> {
  const cleanCode = (inputCode || codeOrIdentifier).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const identifier = inputCode ? codeOrIdentifier.toLowerCase().trim() : '';

  if (!cleanCode) return null;

  if (isRealFirebase && db) {
    try {
      const snap = await getDocs(collection(db, 'sasso_users'));
      for (const d of snap.docs) {
        const u = d.data() as UserProfile;
        if (!u.recoveryCode) continue;
        const uClean = u.recoveryCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (uClean === cleanCode) {
          if (!identifier || u.username.toLowerCase() === identifier || (u.email && u.email.toLowerCase() === identifier) || u.uid.toLowerCase() === identifier) {
            return u;
          }
        }
      }
    } catch (err) {
      console.error('Error finding user by recovery code in Firestore:', err);
    }
  }

  for (const u of localDb.users.values()) {
    if (!u.recoveryCode) continue;
    const uClean = u.recoveryCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (uClean === cleanCode) {
      if (!identifier || u.username.toLowerCase() === identifier || (u.email && u.email.toLowerCase() === identifier) || u.uid.toLowerCase() === identifier) {
        return u;
      }
    }
  }

  return null;
}

export async function regenerateUserRecoveryCode(identifier: string): Promise<string> {
  const user = await getUserProfile(identifier);
  if (!user) throw new Error('User not found');
  const newCode = generateRecoveryCode();

  if (isRealFirebase && db) {
    try {
      await updateDoc(doc(db, 'sasso_users', user.username), { recoveryCode: newCode });
    } catch (err) {
      console.error('Error updating recovery code in Firestore:', err);
      await setDoc(doc(db, 'sasso_users', user.username), { recoveryCode: newCode }, { merge: true });
    }
  }

  user.recoveryCode = newCode;
  localDb.users.set(user.username, user);

  return newCode;
}

export async function deleteUserAccount(email: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_users', emailLower));
      
      const authQ = query(collection(db, 'sasso_authenticators'), where('email', '==', emailLower));
      const authSnap = await getDocs(authQ);
      authSnap.forEach(d => deleteDoc(doc(db, 'sasso_authenticators', d.id)));

      const rtQ = query(collection(db, 'sasso_refresh_tokens'), where('email', '==', emailLower));
      const rtSnap = await getDocs(rtQ);
      rtSnap.forEach(d => deleteDoc(doc(db, 'sasso_refresh_tokens', d.id)));
    } catch (err) {
      console.error('Error deleting user account from Firestore:', err);
    }
  }

  localDb.users.delete(emailLower);
  for (const [id, auth] of localDb.authenticators.entries()) {
    if (auth.email === emailLower) localDb.authenticators.delete(id);
  }
  for (const [id, rt] of localDb.refreshTokens.entries()) {
    if (rt.email === emailLower) localDb.refreshTokens.delete(id);
  }
}

// Verification Code Management
export async function saveVerificationCode(email: string, code: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const data: VerificationCodeRecord = {
    email: emailLower,
    code,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 mins
    createdAt: new Date().toISOString()
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_verification_codes', emailLower), data);
    } catch (err) {
      console.error('Error saving verification code to Firestore:', err);
    }
  }
  localDb.verificationCodes.set(emailLower, data);
}

export async function getVerificationCode(email: string): Promise<VerificationCodeRecord | null> {
  const emailLower = email.toLowerCase().trim();
  let record: VerificationCodeRecord | null = null;
  if (isRealFirebase && db) {
    try {
      const snap = await getDoc(doc(db, 'sasso_verification_codes', emailLower));
      if (snap.exists()) {
        record = snap.data() as VerificationCodeRecord;
      }
    } catch (err) {
      console.error('Error getting verification code from Firestore:', err);
    }
  }
  if (!record) {
    record = localDb.verificationCodes.get(emailLower) || null;
  }
  if (!record) return null;

  if (record.expiresAt < Date.now()) {
    await deleteVerificationCode(emailLower);
    return null;
  }
  return record;
}

export async function deleteVerificationCode(email: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_verification_codes', emailLower));
    } catch (err) {
      console.error('Error deleting verification code from Firestore:', err);
    }
  }
  localDb.verificationCodes.delete(emailLower);
}

export async function updateUserEmailAndVerification(uid: string, newEmail: string, isVerified: boolean): Promise<UserProfile | null> {
  const newEmailLower = newEmail.toLowerCase().trim();
  const nowStr = new Date().toISOString();
  const updates = {
    email: newEmailLower,
    isEmailVerified: isVerified,
    emailVerifiedAt: isVerified ? nowStr : undefined
  };

  if (isRealFirebase && db) {
    try {
      const q = query(collection(db, 'sasso_users'), where('uid', '==', uid));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const userDocRef = doc(db, 'sasso_users', querySnap.docs[0].id);
        await updateDoc(userDocRef, updates);
      }
    } catch (err) {
      console.error('Error updating user email and verification in Firestore:', err);
    }
  }

  for (const [key, user] of localDb.users.entries()) {
    if (user.uid === uid) {
      user.email = newEmailLower;
      user.isEmailVerified = isVerified;
      if (isVerified) user.emailVerifiedAt = nowStr;
      localDb.users.set(key, user);
      if (key !== newEmailLower) {
        localDb.users.set(newEmailLower, user);
      }
      return user;
    }
  }

  return await getUserById(uid);
}

export async function updateUserEmailVerification(email: string, isVerified: boolean): Promise<UserProfile | null> {
  const emailLower = email.toLowerCase().trim();
  const updates = {
    isEmailVerified: isVerified,
    emailVerifiedAt: isVerified ? new Date().toISOString() : undefined
  };

  if (isRealFirebase && db) {
    try {
      const userRef = doc(db, 'sasso_users', emailLower);
      await updateDoc(userRef, updates);
    } catch (err) {
      console.error('Error updating user email verification in Firestore:', err);
    }
  }

  const localUser = localDb.users.get(emailLower);
  if (localUser) {
    localUser.isEmailVerified = isVerified;
    if (isVerified) localUser.emailVerifiedAt = updates.emailVerifiedAt;
  }

  return await getUserProfile(emailLower);
}

export async function getUserById(userId: string): Promise<UserProfile | null> {
  if (isRealFirebase && db) {
    try {
      const q = query(collection(db, 'sasso_users'), where('uid', '==', userId));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        return querySnap.docs[0].data() as UserProfile;
      }
    } catch (err) {
      console.error('Error searching user by ID in Firestore:', err);
    }
  }

  for (const user of localDb.users.values()) {
    if (user.uid === userId) {
      return user;
    }
  }
  return null;
}

// Authorization Codes (Using sasso_auth_codes)
export async function createAuthorizationCode(
  userId: string,
  clientId: string,
  redirectUri: string,
  accessType: 'offline' | 'online' = 'offline',
  options?: {
    state?: string;
    nonce?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }
): Promise<string> {
  const code = 'code_' + crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes expiry
  const authCodeData: AuthCode = {
    code,
    userId,
    clientId,
    redirectUri,
    expiresAt,
    used: false,
    accessType,
    state: options?.state,
    nonce: options?.nonce,
    codeChallenge: options?.codeChallenge,
    codeChallengeMethod: options?.codeChallengeMethod
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_auth_codes', code), authCodeData);
    } catch (err) {
      console.error('Error in Firestore createAuthorizationCode:', err);
    }
  }

  localDb.authCodes.set(code, authCodeData);
  return code;
}

export async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  clientSecret?: string,
  codeVerifier?: string
): Promise<AuthCode | null> {
  const apps = await getClientApps();
  const clientApp = apps.find(app => app.id === clientId);

  let authCode: AuthCode | null = null;
  if (isRealFirebase && db) {
    try {
      const snap = await getDoc(doc(db, 'sasso_auth_codes', code));
      if (snap.exists()) {
        authCode = snap.data() as AuthCode;
      }
    } catch (err) {
      console.error('Error retrieving auth code from Firestore:', err);
    }
  }

  if (!authCode) {
    authCode = localDb.authCodes.get(code) || null;
  }

  if (!authCode) {
    console.error('Auth code not found:', code);
    return null;
  }

  if (authCode.clientId !== clientId) {
    console.error(`Auth code client ID mismatch: expected ${authCode.clientId}, got ${clientId}`);
    return null;
  }

  if (authCode.used) {
    console.error('Auth code already used:', code);
    return null;
  }

  if (authCode.expiresAt < Date.now()) {
    console.error('Auth code expired:', code);
    return null;
  }

  // PKCE Validation (RFC 7636)
  if (authCode.codeChallenge) {
    if (!codeVerifier) {
      console.error('PKCE Verification failed: code_verifier parameter is required for this authorization code');
      return null;
    }

    const method = authCode.codeChallengeMethod || 'S256';
    let computedChallenge = codeVerifier;
    if (method === 'S256') {
      const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64');
      computedChallenge = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    if (computedChallenge !== authCode.codeChallenge) {
      console.error('PKCE Verification failed: code_verifier does not match code_challenge');
      return null;
    }
  }

  // Validate client secret if provided or if PKCE challenge was not used
  if (clientSecret || !authCode.codeChallenge) {
    if (!clientApp || clientApp.clientSecret !== clientSecret) {
      console.error(`Invalid client secret for client ID: ${clientId}`);
      return null;
    }
  }

  authCode.used = true;
  if (isRealFirebase && db) {
    try {
      await updateDoc(doc(db, 'sasso_auth_codes', code), { used: true });
    } catch (err) {
      console.error('Error marking auth code as used in Firestore:', err);
    }
  }
  localDb.authCodes.set(code, authCode);

  return authCode;
}

// --- WebAuthn Challenges Persistence (Using sasso_challenges) ---
export async function saveChallenge(challengeId: string, challenge: string, username?: string): Promise<void> {
  if (!challengeId) return;
  const now = Date.now();
  const expiredAt = new Date(now + 60000).toISOString();

  let user = username ? await getUserProfile(username) : null;

  const data = {
    challengeId,
    challenge,
    username: user ? user.username : (username || ''),
    userId: user ? user.uid : '',
    createdAt: new Date(now).toISOString(),
    expiredAt,
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_challenges', challengeId), data);
    } catch (err) {
      console.error('Error saving challenge to Firestore:', err);
    }
  }
  localDb.challenges.set(challengeId, data);
}

export async function cleanExpiredChallenges(): Promise<void> {
  // No-op or cleanup expired entries
  const now = Date.now();
  for (const [id, challenge] of localDb.challenges.entries()) {
    const expMs = challenge.expiredAt ? new Date(challenge.expiredAt).getTime() : 0;
    if (expMs > 0 && now >= expMs) {
      localDb.challenges.delete(id);
    }
  }
}

export async function markChallengeExpired(challengeId: string): Promise<void> {
  await deleteChallenge(challengeId);
}

export async function cancelChallenge(challengeId: string): Promise<void> {
  await deleteChallenge(challengeId);
}

export async function markChallengeUsed(challengeId: string): Promise<void> {
  await deleteChallenge(challengeId);
}

export async function getChallenge(challengeId: string): Promise<{ challenge: string; username?: string; userId?: string } | null> {
  if (!challengeId) return null;
  let challengeData: any = null;

  if (isRealFirebase && db) {
    try {
      const snap = await getDoc(doc(db, 'sasso_challenges', challengeId));
      if (snap.exists()) {
        challengeData = snap.data();
      }
    } catch (err) {
      console.error('Error reading challenge from Firestore:', err);
    }
  }

  if (!challengeData) {
    challengeData = localDb.challenges.get(challengeId);
  }

  if (!challengeData) return null;

  const now = Date.now();
  const createdMs = challengeData.createdAt ? new Date(challengeData.createdAt).getTime() : Date.now();
  const expMs = challengeData.expiredAt ? new Date(challengeData.expiredAt).getTime() : (createdMs + 60000);

  // Check 1 Minute Expiry (60,000 ms)
  if (now >= expMs) {
    console.warn(`⚠️ Passkey challenge ${challengeId} expired after ${Math.round((now - createdMs) / 1000)}s (>60s limit). Deleting from DB...`);
    await deleteChallenge(challengeId);
    return null;
  }

  return {
    challenge: challengeData.challenge,
    username: challengeData.username,
    userId: challengeData.userId
  };
}

export async function deleteChallenge(challengeId: string): Promise<void> {
  if (!challengeId) return;
  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_challenges', challengeId));
    } catch (err) {
      console.error('Error deleting challenge from Firestore:', err);
    }
  }
  localDb.challenges.delete(challengeId);
}

// --- WebAuthn Authenticators Persistence (Stored in sasso_users document) ---
export async function saveAuthenticator(
  identifier: string,
  credentialID: string,
  credentialPublicKey: string,
  counter: number,
  transports: string[],
  userId?: string,
  deviceName?: string,
  authenticatorType?: string,
  aaguid?: string,
  credentialDeviceType?: string,
  credentialBackedUp?: boolean
): Promise<void> {
  if (!credentialID) return;

  const user = await getUserProfile(identifier);
  if (!user) return;

  const transportList = transports || [];
  
  // Smart default naming for passkeys
  let defaultDeviceName = deviceName;
  if (!defaultDeviceName) {
    if (transportList.includes('usb') || transportList.includes('nfc')) {
      defaultDeviceName = 'Hardware Security Key (YubiKey)';
    } else if (transportList.includes('internal')) {
      defaultDeviceName = 'Built-in Touch ID / Face ID / Biometric';
    } else if (transportList.includes('hybrid')) {
      defaultDeviceName = 'Cross-Device / Phone Passkey';
    } else {
      defaultDeviceName = 'Passkey Authenticator Device';
    }
  }

  const defaultType = authenticatorType || (
    transportList.includes('usb') || transportList.includes('nfc') ? 'Security Key (YubiKey)' : 'Platform Passkey'
  );

  const authData: any = {
    credentialID,
    credentialPublicKey,
    username: user.username,
    ...(user.email ? { email: user.email } : {}),
    userId: userId || user.uid,
    deviceName: defaultDeviceName,
    authenticatorType: defaultType,
    transports: transportList,
    ...(aaguid ? { aaguid } : {}),
    ...(credentialDeviceType ? { credentialDeviceType } : {}),
    ...(credentialBackedUp !== undefined ? { credentialBackedUp } : {}),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    counter
  };

  if (isRealFirebase && db) {
    try {
      const userRef = doc(db, 'sasso_users', user.username);
      // Ensure authenticators array field is deleted from user document in Firestore
      await updateDoc(userRef, { authenticators: deleteField() }).catch(() => {});
      // Store authenticator in user's subcollection AND top-level collection for fast lookup without index requirement
      await setDoc(doc(db, 'sasso_users', user.username, 'sasso_authenticators', credentialID), authData, { merge: true });
      await setDoc(doc(db, 'sasso_authenticators', credentialID), authData, { merge: true });
    } catch (err) {
      console.error('Error saving authenticator in Firestore:', err);
    }
  }

  localDb.authenticators.set(credentialID, authData);
}

export async function getUserAuthenticators(identifier: string): Promise<any[]> {
  if (!identifier) return [];
  const cleanId = identifier.toLowerCase().trim();

  if (isRealFirebase && db) {
    try {
      // 1. Check direct subcollection assuming cleanId is username
      const authsCol = collection(db, 'sasso_users', cleanId, 'sasso_authenticators');
      const snap = await getDocs(authsCol);
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      if (list.length > 0) return list;

      // 2. Look up sasso_users doc directly to handle email / uid lookup without getUserProfile
      const userRef = doc(db, 'sasso_users', cleanId);
      const userDocSnap = await getDoc(userRef);
      let targetUsername = cleanId;

      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        targetUsername = data.username || cleanId;
      } else {
        const qUser = query(collection(db, 'sasso_users'), where('username', '==', cleanId));
        let qSnap = await getDocs(qUser);
        if (qSnap.empty) {
          const qEmail = query(collection(db, 'sasso_users'), where('email', '==', cleanId));
          qSnap = await getDocs(qEmail);
        }
        if (qSnap.empty) {
          const qUid = query(collection(db, 'sasso_users'), where('uid', '==', cleanId));
          qSnap = await getDocs(qUid);
        }
        if (!qSnap.empty) {
          const data = qSnap.docs[0].data();
          targetUsername = data.username || cleanId;
        }
      }

      if (targetUsername) {
        const authsCol2 = collection(db, 'sasso_users', targetUsername, 'sasso_authenticators');
        const snap2 = await getDocs(authsCol2);
        const list2: any[] = [];
        snap2.forEach(d => list2.push(d.data()));
        if (list2.length > 0) return list2;

        const qTop = query(collection(db, 'sasso_authenticators'), where('username', '==', targetUsername));
        const snapTop = await getDocs(qTop);
        snapTop.forEach(d => list2.push(d.data()));
        if (list2.length > 0) return list2;
      }
    } catch (err) {
      console.error('Error reading authenticators subcollection:', err);
    }
  }

  const list: any[] = [];
  for (const auth of localDb.authenticators.values()) {
    if (
      auth.username?.toLowerCase() === cleanId ||
      auth.email?.toLowerCase() === cleanId ||
      auth.userId === cleanId
    ) {
      list.push(auth);
    }
  }
  return list;
}

export async function deleteAuthenticator(credentialID: string, identifier?: string): Promise<{ success: boolean; error?: string }> {
  if (!credentialID) return { success: false, error: 'Credential ID required' };
  
  let user = identifier ? await getUserProfile(identifier) : null;
  if (!user) {
    const all = await getAllUsers();
    for (const u of all) {
      const auths = await getUserAuthenticators(u.username);
      if (auths.some(a => a.credentialID === credentialID)) {
        user = u;
        break;
      }
    }
  }

  if (!user) return { success: false, error: 'User not found' };

  const auths = await getUserAuthenticators(user.username);
  if (auths.length <= 1) {
    return { success: false, error: 'At least one registered passkey must remain on your account for security.' };
  }

  if (isRealFirebase && db) {
    try {
      await updateDoc(doc(db, 'sasso_users', user.username), { authenticators: deleteField() }).catch(() => {});
      await deleteDoc(doc(db, 'sasso_users', user.username, 'sasso_authenticators', credentialID));
      await deleteDoc(doc(db, 'sasso_authenticators', credentialID)).catch(() => {});
    } catch (err) {
      console.error('Error deleting authenticator from Firestore:', err);
    }
  }

  localDb.authenticators.delete(credentialID);
  return { success: true };
}

export async function getAuthenticator(credentialID: string): Promise<any | null> {
  if (!credentialID) return null;

  if (localDb.authenticators.has(credentialID)) {
    return localDb.authenticators.get(credentialID);
  }

  if (isRealFirebase && db) {
    try {
      // 1. Direct doc lookup in top-level sasso_authenticators (O(1))
      const directSnap = await getDoc(doc(db, 'sasso_authenticators', credentialID));
      if (directSnap.exists()) {
        const data = directSnap.data();
        localDb.authenticators.set(credentialID, data);
        return data;
      }

      // 2. Fallback: Iterate user subcollections to find credential and self-heal
      const usersSnap = await getDocs(collection(db, 'sasso_users'));
      for (const uDoc of usersSnap.docs) {
        const username = uDoc.id;
        const subDoc = await getDoc(doc(db, 'sasso_users', username, 'sasso_authenticators', credentialID));
        if (subDoc.exists()) {
          const authData = subDoc.data();
          // Self-heal: Copy to top-level collection for fast future lookups
          await setDoc(doc(db, 'sasso_authenticators', credentialID), authData, { merge: true }).catch(() => {});
          localDb.authenticators.set(credentialID, authData);
          return authData;
        }
      }
    } catch (err: any) {
      console.error('Error reading authenticator from Firestore:', err);
    }
  }

  for (const auth of localDb.authenticators.values()) {
    if (auth.credentialID === credentialID) return auth;
  }

  return null;
}

export async function clearUserAuthenticators(identifier: string): Promise<number> {
  const user = await getUserProfile(identifier);
  if (!user) return 0;

  const auths = await getUserAuthenticators(user.username);
  const count = auths.length;

  if (isRealFirebase && db) {
    try {
      await updateDoc(doc(db, 'sasso_users', user.username), { authenticators: deleteField() }).catch(() => {});
      for (const a of auths) {
        if (a.credentialID) {
          await deleteDoc(doc(db, 'sasso_users', user.username, 'sasso_authenticators', a.credentialID)).catch(() => {});
          await deleteDoc(doc(db, 'sasso_authenticators', a.credentialID)).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Error clearing authenticators:', err);
    }
  }

  for (const a of auths) {
    if (a.credentialID) localDb.authenticators.delete(a.credentialID);
  }
  return count;
}

export async function updateAuthenticatorCounter(credentialID: string, newCounter: number): Promise<void> {
  if (!credentialID) return;
  const nowStr = new Date().toISOString();

  const auth = await getAuthenticator(credentialID);
  if (auth && auth.username) {
    auth.counter = newCounter;
    auth.lastUsedAt = nowStr;

    if (isRealFirebase && db) {
      try {
        await setDoc(doc(db, 'sasso_users', auth.username, 'sasso_authenticators', credentialID), { counter: newCounter, lastUsedAt: nowStr }, { merge: true });
        await setDoc(doc(db, 'sasso_authenticators', credentialID), { counter: newCounter, lastUsedAt: nowStr }, { merge: true });
      } catch (err) {
        console.error('Error updating counter in Firestore:', err);
      }
    }
  }

  const local = localDb.authenticators.get(credentialID);
  if (local) {
    local.counter = newCounter;
    local.lastUsedAt = nowStr;
    localDb.authenticators.set(credentialID, local);
  }
}


export async function getAllUsers(): Promise<UserProfile[]> {
  if (isRealFirebase && db) {
    try {
      const q = query(collection(db, 'sasso_users'));
      const snap = await getDocs(q);
      const list: UserProfile[] = [];
      snap.forEach(d => {
        list.push(d.data() as UserProfile);
      });
      return list;
    } catch (err) {
      console.error('Error reading users list from Firestore:', err);
    }
  }

  return Array.from(localDb.users.values());
}

// --- User Authorized Apps Persistence (Using sasso_user_authorized_apps) ---
export async function addAuthorizedApp(email: string, clientId: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const docId = `${emailLower}_${clientId}`;
  const data = {
    email: emailLower,
    clientId,
    authorizedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_user_authorized_apps', docId), data, { merge: true });
    } catch (err) {
      console.error('Error saving authorized app to Firestore:', err);
    }
  }
  localDb.authorizedApps.set(docId, data);
}

export async function getUserAuthorizedApps(email: string): Promise<ClientApp[]> {
  const emailLower = email.toLowerCase().trim();
  const allApps = await getClientApps();
  const authorizedClientIds = new Set<string>();

  if (isRealFirebase && db) {
    try {
      const q = query(collection(db, 'sasso_user_authorized_apps'), where('email', '==', emailLower));
      const snap = await getDocs(q);
      snap.forEach(d => {
        const data = d.data();
        if (data.clientId) {
          authorizedClientIds.add(data.clientId);
        }
      });
    } catch (err) {
      console.error('Error reading authorized apps from Firestore:', err);
    }
  } else {
    for (const item of localDb.authorizedApps.values()) {
      if (item.email === emailLower && item.clientId) {
        authorizedClientIds.add(item.clientId);
      }
    }
  }

  return allApps.filter(app => authorizedClientIds.has(app.id));
}

export async function revokeUserAuthorizedApp(email: string, clientId: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const docId = `${emailLower}_${clientId}`;

  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_user_authorized_apps', docId));
    } catch (err) {
      console.error('Error deleting authorized app from Firestore:', err);
    }
  }
  localDb.authorizedApps.delete(docId);
}

// --- Refresh Tokens Database Persistence & Rotation (sasso_refresh_tokens) ---
function getTokenDocId(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loadLocalRefreshTokens(): Record<string, StoredRefreshToken> {
  try {
    if (fs.existsSync(REFRESH_TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(REFRESH_TOKENS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading refresh tokens file:', err);
  }
  return {};
}

function saveLocalRefreshTokens(tokens: Record<string, StoredRefreshToken>): void {
  try {
    fs.writeFileSync(REFRESH_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing refresh tokens file:', err);
  }
}

export async function saveRefreshToken(
  token: string,
  uid: string,
  email: string,
  clientId: string,
  expiresAt: number,
  clientName?: string
): Promise<void> {
  const docId = getTokenDocId(token);
  const tokenType = clientId === 'central_sso' ? 'central_session' : 'client_app';
  const validEmail = (email && email.includes('@')) ? email.toLowerCase().trim() : '';
  const data: StoredRefreshToken = {
    id: docId,
    token,
    uid,
    email: validEmail,
    clientId,
    clientName: clientName || (clientId === 'central_sso' ? 'Central SSO Server' : clientId),
    tokenType,
    createdAt: new Date().toISOString(),
    expiresAt
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_refresh_tokens', docId), data);
    } catch (err) {
      console.error('Error saving refresh token to Firestore:', err);
    }
  }

  const localTokens = loadLocalRefreshTokens();
  localTokens[docId] = data;
  saveLocalRefreshTokens(localTokens);
  localDb.refreshTokens.set(docId, data);
}

export async function findRefreshToken(token: string): Promise<StoredRefreshToken | null> {
  if (!token) return null;
  const docId = getTokenDocId(token);
  let record: StoredRefreshToken | null = null;

  if (isRealFirebase && db) {
    try {
      const snap = await getDoc(doc(db, 'sasso_refresh_tokens', docId));
      if (snap.exists()) {
        record = snap.data() as StoredRefreshToken;
      }
    } catch (err) {
      console.error('Error finding refresh token in Firestore:', err);
    }
  }

  if (!record) {
    const localTokens = loadLocalRefreshTokens();
    record = localTokens[docId] || localDb.refreshTokens.get(docId) || null;
  }

  if (!record) return null;

  // Check Expiry
  if (record.expiresAt && record.expiresAt < Date.now()) {
    await deleteRefreshToken(token);
    return null;
  }

  return record;
}

export async function deleteRefreshToken(token: string): Promise<void> {
  if (!token) return;
  const docId = getTokenDocId(token);

  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_refresh_tokens', docId));
    } catch (err) {
      console.error('Error deleting refresh token from Firestore:', err);
    }
  }

  const localTokens = loadLocalRefreshTokens();
  if (localTokens[docId]) {
    delete localTokens[docId];
    saveLocalRefreshTokens(localTokens);
  }
  localDb.refreshTokens.delete(docId);
}

export async function revokeAllUserClientRefreshTokens(uid: string, clientId: string): Promise<void> {
  if (!uid || !clientId) return;

  if (isRealFirebase && db) {
    try {
      const q = query(
        collection(db, 'sasso_refresh_tokens'),
        where('uid', '==', uid),
        where('clientId', '==', clientId)
      );
      const snap = await getDocs(q);
      const deletePromises: Promise<void>[] = [];
      snap.forEach(d => {
        deletePromises.push(deleteDoc(doc(db, 'sasso_refresh_tokens', d.id)));
      });
      await Promise.all(deletePromises);
    } catch (err) {
      console.error('Error revoking user refresh tokens in Firestore:', err);
    }
  }

  const localTokens = loadLocalRefreshTokens();
  let updated = false;
  for (const [id, rec] of Object.entries(localTokens)) {
    if (rec.uid === uid && rec.clientId === clientId) {
      delete localTokens[id];
      localDb.refreshTokens.delete(id);
      updated = true;
    }
  }
  if (updated) {
    saveLocalRefreshTokens(localTokens);
  }
}

// --- QR Code Login Sessions Persistence (sasso_qr_sessions) ---
export async function createQrSession(
  qrSessionId: string,
  qrUrl: string,
  ip?: string,
  userAgent?: string
): Promise<any> {
  const data = {
    qrSessionId,
    status: 'pending' as const,
    qrUrl,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    ip: ip || 'Unknown IP',
    userAgent: userAgent || 'Browser'
  };

  if (isRealFirebase && db) {
    try {
      await setDoc(doc(db, 'sasso_qr_sessions', qrSessionId), data);
    } catch (err) {
      console.error('Error saving QR session in Firestore:', err);
    }
  }
  localDb.qrSessions.set(qrSessionId, data);
  return data;
}

export async function getQrSession(qrSessionId: string): Promise<any | null> {
  if (!qrSessionId) return null;
  let record: any = null;

  if (isRealFirebase && db) {
    try {
      const snap = await getDoc(doc(db, 'sasso_qr_sessions', qrSessionId));
      if (snap.exists()) {
        record = snap.data();
      }
    } catch (err) {
      console.error('Error getting QR session from Firestore:', err);
    }
  }

  if (!record) {
    record = localDb.qrSessions.get(qrSessionId) || null;
  }

  if (!record) return null;

  if (record.expiresAt < Date.now()) {
    record.status = 'expired';
  }

  return record;
}

export async function approveQrSession(qrSessionId: string, user: UserProfile, token: string): Promise<any | null> {
  const session = await getQrSession(qrSessionId);
  if (!session || session.status !== 'pending') return null;

  session.status = 'approved';
  session.user = user;
  session.userEmail = user.email;
  session.token = token;

  if (isRealFirebase && db) {
    try {
      await updateDoc(doc(db, 'sasso_qr_sessions', qrSessionId), {
        status: 'approved',
        user: user,
        userEmail: user.email,
        token
      });
    } catch (err) {
      console.error('Error approving QR session in Firestore:', err);
    }
  }
  localDb.qrSessions.set(qrSessionId, session);
  return session;
}

// --- Active User Sessions Management (Stored inside sasso_active_sessions collection ONLY) ---
export async function createActiveSession(
  sessionId: string,
  identifier: string,
  deviceName: string,
  userAgent: string,
  ip: string,
  loginType: 'passkey' | 'qr_code' | 'sso'
): Promise<void> {
  const user = await getUserProfile(identifier);
  if (!user) return;

  const sessionData = {
    sessionId,
    username: user.username,
    userId: user.uid,
    ...(user.email ? { email: user.email } : {}),
    deviceName,
    userAgent,
    ip,
    loginType,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  };

  if (isRealFirebase && db) {
    try {
      // Ensure activeSessions field is removed from user document in sasso_users
      const userRef = doc(db, 'sasso_users', user.username);
      await updateDoc(userRef, { activeSessions: deleteField() }).catch(() => {});
      // Store session in sasso_active_sessions collection ONLY
      await setDoc(doc(db, 'sasso_active_sessions', sessionId), sessionData, { merge: true });
    } catch (err) {
      console.error('Error saving active session in collection:', err);
    }
  }

  localDb.activeSessions.set(sessionId, sessionData);
}

export async function getUserActiveSessions(identifier: string): Promise<any[]> {
  if (!identifier) return [];
  const cleanId = identifier.toLowerCase().trim();

  let targetUsername = cleanId;
  let targetUid = cleanId;

  if (isRealFirebase && db) {
    try {
      const userRef = doc(db, 'sasso_users', cleanId);
      const userDocSnap = await getDoc(userRef);
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        targetUsername = data.username || cleanId;
        targetUid = data.uid || cleanId;
      } else {
        const qUser = query(collection(db, 'sasso_users'), where('username', '==', cleanId));
        let snap = await getDocs(qUser);
        if (snap.empty) {
          const qUid = query(collection(db, 'sasso_users'), where('uid', '==', cleanId));
          snap = await getDocs(qUid);
        }
        if (!snap.empty) {
          const data = snap.docs[0].data();
          targetUsername = data.username || cleanId;
          targetUid = data.uid || cleanId;
        }
      }

      const q1 = query(collection(db, 'sasso_active_sessions'), where('username', '==', targetUsername));
      const snap1 = await getDocs(q1);
      const list: any[] = [];
      snap1.forEach(d => list.push(d.data()));
      if (list.length > 0) return list;

      const q2 = query(collection(db, 'sasso_active_sessions'), where('userId', '==', targetUid));
      const snap2 = await getDocs(q2);
      snap2.forEach(d => list.push(d.data()));
      if (list.length > 0) return list;
    } catch (err) {
      console.error('Error reading active sessions collection:', err);
    }
  }

  const list: any[] = [];
  for (const session of localDb.activeSessions.values()) {
    if (
      session.username?.toLowerCase() === cleanId ||
      session.userId === cleanId ||
      session.username === targetUsername ||
      session.userId === targetUid
    ) {
      list.push(session);
    }
  }
  return list;
}

export async function revokeActiveSession(sessionId: string, identifier?: string): Promise<boolean> {
  if (!sessionId) return false;

  if (isRealFirebase && db) {
    try {
      await deleteDoc(doc(db, 'sasso_active_sessions', sessionId));
    } catch (err) {
      console.error('Error deleting session from collection:', err);
    }
  }

  localDb.activeSessions.delete(sessionId);
  return true;
}

export async function removeAllUserSessions(identifier: string): Promise<void> {
  if (!identifier) return;
  const user = await getUserProfile(identifier);
  const username = user ? user.username : identifier.toLowerCase().trim();
  const uid = user ? user.uid : identifier;

  if (isRealFirebase && db) {
    try {
      if (user) {
        await updateDoc(doc(db, 'sasso_users', user.username), { activeSessions: deleteField() }).catch(() => {});
      }

      const q1 = query(collection(db, 'sasso_active_sessions'), where('username', '==', username));
      const snap1 = await getDocs(q1);
      const deletePromises: Promise<void>[] = [];
      snap1.forEach(d => deletePromises.push(deleteDoc(doc(db, 'sasso_active_sessions', d.id))));

      const q2 = query(collection(db, 'sasso_active_sessions'), where('userId', '==', uid));
      const snap2 = await getDocs(q2);
      snap2.forEach(d => deletePromises.push(deleteDoc(doc(db, 'sasso_active_sessions', d.id))));

      await Promise.all(deletePromises);
    } catch (err) {
      console.error('Error removing user sessions from collection:', err);
    }
  }

  for (const [sId, session] of Array.from(localDb.activeSessions.entries())) {
    if (session.username === username || session.userId === uid) {
      localDb.activeSessions.delete(sId);
    }
  }
}

export async function revokeAllUserRefreshTokens(identifier: string): Promise<void> {
  if (!identifier) return;
  const user = await getUserProfile(identifier);
  const uid = user ? user.uid : identifier;

  if (isRealFirebase && db) {
    try {
      const q1 = query(collection(db, 'sasso_refresh_tokens'), where('uid', '==', uid));
      const snap1 = await getDocs(q1);
      const deletePromises: Promise<void>[] = [];
      snap1.forEach(d => deletePromises.push(deleteDoc(doc(db, 'sasso_refresh_tokens', d.id))));

      await Promise.all(deletePromises);
    } catch (err) {
      console.error('Error revoking refresh tokens in Firestore:', err);
    }
  }

  const localTokens = loadLocalRefreshTokens();
  let updated = false;
  for (const [id, rec] of Object.entries(localTokens)) {
    if (rec.uid === uid) {
      delete localTokens[id];
      localDb.refreshTokens.delete(id);
      updated = true;
    }
  }
  if (updated) {
    saveLocalRefreshTokens(localTokens);
  }
}


