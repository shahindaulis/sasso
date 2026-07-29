import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  registerUser,
  getUserProfile,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getUserById,
  isUsingFirebase,
  defaultApps,
  getClientApps,
  registerClientApp,
  deleteClientApp,
  saveChallenge,
  getChallenge,
  deleteChallenge,
  cancelChallenge,
  markChallengeUsed,
  saveAuthenticator,
  getAuthenticator,
  getUserAuthenticators,
  updateAuthenticatorCounter,
  getAllUsers,
  addAuthorizedApp,
  getUserAuthorizedApps,
  revokeUserAuthorizedApp,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  revokeAllUserClientRefreshTokens,
  saveVerificationCode,
  getVerificationCode,
  deleteVerificationCode,
  updateUserEmailVerification,
  updateUserEmailAndVerification,
  clearUserAuthenticators,
  findUserByRecoveryCode,
  regenerateUserRecoveryCode,
  deleteAuthenticator,
  createQrSession,
  getQrSession,
  approveQrSession,
  createActiveSession,
  getUserActiveSessions,
  revokeActiveSession,
  removeAllUserSessions,
  revokeAllUserRefreshTokens
} from './src/db';
import { sendVerificationEmail } from './src/emailService';

dotenv.config();

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sasso_super_secret_key_112233';

app.use(express.json());
app.use(cookieParser());

function setCentralRefreshTokenCookie(res: express.Response, refreshToken: string) {
  res.cookie('sasso_refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearCentralRefreshTokenCookie(res: express.Response) {
  res.clearCookie('sasso_refresh_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
}

// Enable CORS with credentials support for HttpOnly cookies
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// API logging middleware to trace OAuth/OIDC traffic and security events
const ssoTrafficLogs: any[] = [];
const logTraffic = (protocol: string, type: string, source: string, destination: string, message: string, details?: any) => {
  const log = {
    id: 'log_' + Math.random().toString(36).substring(2, 11),
    timestamp: new Date().toISOString(),
    protocol,
    type,
    source,
    destination,
    message,
    details
  };
  ssoTrafficLogs.push(log);
  if (ssoTrafficLogs.length > 200) {
    ssoTrafficLogs.shift(); // Keep last 200 logs
  }
};

// ------------------ INPUT SANITIZATION & VALIDATION ------------------

function sanitizeString(input: any): string {
  if (typeof input !== 'string') return '';
  // Strip control characters, script/HTML tags, null bytes, and trim
  return input
    .replace(/\0/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string') return sanitizeString(obj);
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    // Keep raw webauthn passkey challenge & response objects intact, sanitize text fields
    if (key === 'registrationResponse' || key === 'authenticationResponse' || key === 'response') {
      sanitized[key] = obj[key];
    } else {
      sanitized[key] = sanitizeObject(obj[key]);
    }
  }
  return sanitized;
}

const sanitizeInputsMiddleware: express.RequestHandler = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }
  next();
};

app.use('/api', sanitizeInputsMiddleware);

// ------------------ RATE LIMITING MIDDLEWARE ------------------

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

function createRateLimiter(options: { windowMs: number; max: number; keyPrefix: string; message: string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${options.keyPrefix}:${clientIp}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + options.windowMs };
      rateLimitStore.set(key, record);
    } else {
      record.count += 1;
    }

    if (record.count > options.max) {
      logTraffic(
        'Rate Limiter',
        'rate_limit',
        clientIp,
        req.path,
        `Rate limit exceeded: ${record.count}/${options.max} requests`
      );
      return res.status(429).json({
        error: options.message,
        retryAfterSeconds: Math.ceil((record.resetTime - now) / 1000)
      });
    }

    next();
  };
}

// Strict limiter for authentication & security operations (30 attempts per 15 minutes)
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: 'auth_rl',
  message: 'Too many authentication or sensitive attempts from this IP. Please try again after 15 minutes.'
});

const getRpIDAndOrigin = (req: any) => {
  const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const rpID = hostHeader.split(':')[0];

  let proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  if (!hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1')) {
    proto = 'https';
  }
  const expectedOrigin = `${proto}://${hostHeader}`;
  return { rpID, expectedOrigin };
};

// ------------------ API ROUTES ------------------

// Check backend status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    firebaseConnected: isUsingFirebase(),
    timestamp: new Date().toISOString()
  });
});

// Fetch active traffic logs for protocol inspector & security audit logger
app.get('/api/sso/logs', (req, res) => {
  res.json(ssoTrafficLogs);
});

app.get('/api/traffic-logs', (req, res) => {
  res.json({ logs: ssoTrafficLogs });
});

// Clear traffic logs
app.post('/api/sso/logs/clear', (req, res) => {
  ssoTrafficLogs.length = 0;
  res.json({ status: 'cleared' });
});

// Refresh Token Store for Rotation and Reuse Detection
interface RefreshTokenSession {
  tokenId: string;
  familyId: string;
  email: string;
  uid: string;
  isValid: boolean;
  createdAt: string;
}

const activeRefreshTokens = new Map<string, RefreshTokenSession>();

function issueCentralTokens(user: { uid: string; username: string; email?: string }, existingFamilyId?: string) {
  const familyId = existingFamilyId || 'fam_' + crypto.randomBytes(8).toString('hex');
  const tokenId = 'rt_' + crypto.randomBytes(12).toString('hex');

  // Short-lived Access Token (15 minutes)
  const accessToken = jwt.sign(
    { uid: user.uid, username: user.username, email: user.email, type: 'central_sso' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Long-lived Refresh Token (7 days)
  const refreshToken = jwt.sign(
    { uid: user.uid, username: user.username, email: user.email, type: 'central_sso_refresh', jti: tokenId, familyId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  activeRefreshTokens.set(tokenId, {
    tokenId,
    familyId,
    email: user.email || user.username,
    uid: user.uid,
    isValid: true,
    createdAt: new Date().toISOString(),
  });

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  saveRefreshToken(refreshToken, user.uid, user.email || user.username, 'central_sso', Date.now() + sevenDaysMs).catch(err => {
    console.error('Error saving central refresh token in DB:', err);
  });

  return { accessToken, refreshToken, expiresIn: 900, familyId };
}

// Helper to verify central SSO JWT from request headers or body
function verifyCentralToken(req: express.Request): { uid: string; username: string; email?: string; type: string } | null {
  try {
    let token = req.body?.token || req.query?.token;
    const authHeader = req.headers.authorization;
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded && decoded.type === 'central_sso' && (decoded.username || decoded.email)) {
      return decoded;
    }
  } catch (err) {
    return null;
  }
  return null;
}

// Get registered client apps (Protected: only returns apps owned by the authenticated user)
app.get('/api/sso/apps', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Central SSO token required' });
  }

  const allApps = await getClientApps();
  const userApps = allApps.filter(app => app.ownerEmail === decoded.email);
  res.json(userApps);
});

// Public single app info lookup for OAuth consent screen
app.get('/api/sso/apps/public-info', async (req, res) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId required' });
  }
  const allApps = await getClientApps();
  const found = allApps.find(a => a.id === clientId);
  if (!found) {
    return res.status(404).json({ error: 'App not found' });
  }
  res.json({
    id: found.id,
    name: found.name,
    description: found.description,
    logo: found.logo,
    accentColor: found.accentColor,
    url: found.url,
    redirectUri: found.redirectUri,
    isFirstParty: !!found.isFirstParty,
  });
});

// Register custom client app dynamically (Protected: tags newly created app with ownerEmail)
app.post('/api/sso/apps/register', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Central SSO token required' });
  }

  const { name, description, url, redirectUri, accentColor, isFirstParty } = req.body;

  if (!name || !url || !redirectUri) {
    return res.status(400).json({ error: 'Missing required app details (Name, URL, Redirect URI)' });
  }

  // Generate clean client ID and client Secret
  const id = 'client_' + Math.random().toString(36).substring(2, 11);
  const clientSecret = 'sasso_sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  const newApp = {
    id,
    name,
    description: description || 'Custom Registered OIDC Application',
    logo: 'Briefcase',
    url,
    redirectUri,
    clientSecret,
    accentColor: accentColor || '#4F46E5', // default Indigo
    ownerEmail: decoded.email,
    isFirstParty: Boolean(isFirstParty),
  };

  await registerClientApp(newApp);
  logTraffic('Central Auth', 'success', 'Developer Console', 'SSO Server', `Registered new client app: ${name} (ID: ${id}) for ${decoded.email}`);

  const allApps = await getClientApps();
  const userApps = allApps.filter(app => app.ownerEmail === decoded.email);
  res.json({ app: newApp, apps: userApps });
});

// Delete custom client app dynamically (Protected: verifies ownership before deleting)
app.post('/api/sso/apps/delete', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Central SSO token required' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing app ID' });
  }

  const allApps = await getClientApps();
  const targetApp = allApps.find(a => a.id === id);

  if (targetApp && targetApp.ownerEmail && targetApp.ownerEmail !== decoded.email) {
    return res.status(403).json({ error: 'Forbidden: You do not own this application' });
  }

  await deleteClientApp(id);
  logTraffic('Central Auth', 'success', 'Developer Console', 'SSO Server', `Deleted client app ID: ${id} by ${decoded.email}`);

  const remainingApps = await getClientApps();
  const userApps = remainingApps.filter(app => app.ownerEmail === decoded.email);
  res.json({ success: true, apps: userApps });
});

// WebAuthn Passkey Registration - Get Options
app.post('/api/sso/register/options', async (req, res) => {
  const decoded = verifyCentralToken(req);
  const { username, email } = req.body;

  let loggedInUser: any = null;
  if (decoded) {
    loggedInUser = (decoded.username ? await getUserProfile(decoded.username) : null) ||
                   (decoded.email ? await getUserProfile(decoded.email) : null) ||
                   (decoded.uid ? await getUserById(decoded.uid) : null);
  }

  let usernameLower = '';
  let uid = '';

  if (loggedInUser) {
    // 1. Authenticated user adding a passkey/device to their existing account
    usernameLower = loggedInUser.username.toLowerCase().trim();
    uid = loggedInUser.uid;
  } else {
    // 2. Unauthenticated user attempting to SIGN UP (Create new account)
    const rawInput = username || email;
    if (!rawInput) {
      return res.status(400).json({ error: 'Username is required' });
    }
    usernameLower = rawInput.toLowerCase().trim();

    // Check if username or email is already registered
    const existingUser = (await getUserProfile(usernameLower)) || (email ? await getUserProfile(email.toLowerCase().trim()) : null);
    if (existingUser) {
      return res.status(400).json({ error: 'This username is already registered. Please log in instead or use a different username.' });
    }

    uid = crypto.createHash('sha256').update(usernameLower).digest('hex').substring(0, 32);
  }

  const userAuthenticators = usernameLower ? await getUserAuthenticators(usernameLower) : [];

  const { rpID } = getRpIDAndOrigin(req);
  const rpName = 'sasso Central SSO';

  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(uid), // Register using unique User ID
      userName: usernameLower,
      userDisplayName: usernameLower,
      attestationType: 'direct', // Direct attestation
      excludeCredentials: userAuthenticators.map(auth => ({
        id: auth.credentialID,
        type: 'public-key',
        transports: auth.transports,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    await saveChallenge(options.challenge, options.challenge, usernameLower);
    logTraffic('Central Auth', 'success', 'SSO Server', 'User Client', `Generated Passkey registration options for ${usernameLower}`);
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// WebAuthn Passkey Registration - Verify
app.post('/api/sso/register/verify', async (req, res) => {
  const decoded = verifyCentralToken(req);
  const { username, email, registrationResponse, challenge: bodyChallenge, deviceName, authenticatorType } = req.body;

  let loggedInUser: any = null;
  if (decoded) {
    loggedInUser = (decoded.username ? await getUserProfile(decoded.username) : null) ||
                   (decoded.email ? await getUserProfile(decoded.email) : null) ||
                   (decoded.uid ? await getUserById(decoded.uid) : null);
  }

  let usernameLower = '';
  if (loggedInUser) {
    usernameLower = loggedInUser.username.toLowerCase().trim();
  } else {
    const rawInput = username || email;
    if (!rawInput) {
      return res.status(400).json({ error: 'Missing registration details' });
    }
    usernameLower = rawInput.toLowerCase().trim();

    // Reject unauthenticated attempt if account already exists
    const existingUser = await getUserProfile(usernameLower);
    if (existingUser) {
      return res.status(400).json({ error: 'This account already exists. Please log in to your account.' });
    }
  }

  if (!registrationResponse) {
    return res.status(400).json({ error: 'Missing registration details' });
  }

  const challenge = bodyChallenge || (registrationResponse.response && (registrationResponse.response as any).challenge);

  // Retrieve expected challenge
  const challengeRecord = await getChallenge(challenge);
  if (!challengeRecord) {
    return res.status(400).json({ error: 'Registration challenge not found or expired' });
  }

  const { rpID, expectedOrigin } = getRpIDAndOrigin(req);

  try {
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential, aaguid, credentialDeviceType, credentialBackedUp } = verification.registrationInfo as any;
      const credentialIDStr = credential.id;
      const credentialPublicKeyStr = Buffer.from(credential.publicKey).toString('base64');
      const counter = credential.counter;
      
      await deleteChallenge(challenge);

      // Get or save user
      let user = loggedInUser;
      if (!user) {
        user = await getUserProfile(usernameLower);
      }
      if (!user) {
        user = await registerUser(usernameLower);
      }

      await saveAuthenticator(
        user.username,
        credentialIDStr,
        credentialPublicKeyStr,
        counter,
        registrationResponse.response.transports || [],
        user.uid,
        deviceName,
        authenticatorType,
        aaguid,
        credentialDeviceType,
        credentialBackedUp
      );

      await markChallengeUsed(challenge);

      // Record active session only for new account registration (not when adding a passkey to an existing logged-in session)
      let sessionId = '';
      if (!loggedInUser) {
        sessionId = 'sess_' + crypto.randomBytes(16).toString('hex');
        const userAgent = req.headers['user-agent'] || 'Unknown Browser';
        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
        await createActiveSession(sessionId, user.username, deviceName || 'Device Passkey', userAgent, ip, 'passkey');
      }

      // Generate central sso tokens (access token + refresh token with rotation)
      const tokens = issueCentralTokens(user);
      setCentralRefreshTokenCookie(res, tokens.refreshToken);

      logTraffic('Central Auth', 'success', 'SSO Server', 'User Client', `Verified and saved Passkey for ${user.username} (UID: ${user.uid})`);
      res.json({
        verified: true,
        user,
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        sessionId
      });
    } else {
      res.status(400).json({ error: 'Passkey verification failed' });
    }
  } catch (err: any) {
    logTraffic('Central Auth', 'error', 'SSO Server', 'User Client', `Passkey verification error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// WebAuthn Passkey Login - Get Options (Supports Usernameless if no username is supplied)
app.post('/api/sso/login/options', async (req, res) => {
  const { username, email } = req.body;
  const rawInput = username || email;
  const { rpID } = getRpIDAndOrigin(req);

  let allowCredentials = undefined;
  if (rawInput) {
    const usernameLower = rawInput.toLowerCase().trim();
    const userAuthenticators = await getUserAuthenticators(usernameLower);
    allowCredentials = userAuthenticators.map(auth => ({
      id: auth.credentialID,
      type: 'public-key' as const,
      transports: auth.transports,
    }));
  }

  try {
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'required', // User verification required
    });

    await saveChallenge(options.challenge, options.challenge, rawInput ? rawInput.toLowerCase().trim() : undefined);
    logTraffic('Central Auth', 'success', 'SSO Server', 'User Client', `Generated Passkey login options ${rawInput ? 'for ' + rawInput : '(usernameless)'}`);
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// WebAuthn Passkey Login - Verify
app.post('/api/sso/login/verify', async (req, res) => {
  const { loginResponse, challenge: bodyChallenge } = req.body;
  if (!loginResponse) {
    return res.status(400).json({ error: 'Missing login verification response' });
  }

  const { rpID, expectedOrigin } = getRpIDAndOrigin(req);

  const challenge = bodyChallenge || (loginResponse.response && (loginResponse.response as any).challenge);

  try {
    const challengeRecord = await getChallenge(challenge);
    if (!challengeRecord) {
      return res.status(400).json({ error: 'Authentication challenge not found or expired' });
    }

    const credentialIDStr = loginResponse.id;
    const authenticator = await getAuthenticator(credentialIDStr);
    if (!authenticator) {
      return res.status(400).json({ error: 'No registered Passkey matches this device' });
    }

    const dbAuthenticator = {
      id: authenticator.credentialID,
      publicKey: Buffer.from(authenticator.credentialPublicKey, 'base64'),
      counter: authenticator.counter,
      transports: authenticator.transports,
    };

    const verification = await verifyAuthenticationResponse({
      response: loginResponse,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: dbAuthenticator,
      requireUserVerification: true, // User verification required & counter checked automatically
    });

    if (verification.verified && verification.authenticationInfo) {
      const { newCounter } = verification.authenticationInfo;
      await updateAuthenticatorCounter(credentialIDStr, newCounter);
      await markChallengeUsed(challenge);

      const user = await getUserProfile(authenticator.username || authenticator.email);
      if (!user) {
        return res.status(404).json({ error: 'Associated user profile not found' });
      }

      // Record active session
      const sessionId = 'sess_' + crypto.randomBytes(16).toString('hex');
      const userAgent = req.headers['user-agent'] || 'Unknown Browser';
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
      await createActiveSession(sessionId, user.username, authenticator.deviceName || 'Passkey Device', userAgent, ip, 'passkey');

      // Generate central sso tokens (access token + refresh token with rotation)
      const tokens = issueCentralTokens(user);
      setCentralRefreshTokenCookie(res, tokens.refreshToken);

      logTraffic('Central Auth', 'success', 'SSO Server', 'User Client', `User ${user.username} signed in via Passkey successfully`);
      res.json({
        verified: true,
        user,
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        sessionId
      });
    } else {
      res.status(400).json({ error: 'Passkey authentication failed' });
    }
  } catch (err: any) {
    logTraffic('Central Auth', 'error', 'SSO Server', 'User Client', `Passkey verification error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});



// Verify Central SSO Token and return user details
app.post('/api/sso/verify-central', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.type !== 'central_sso') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const user = (decoded.username ? await getUserProfile(decoded.username) : null) ||
                 (decoded.email ? await getUserProfile(decoded.email) : null) ||
                 (decoded.uid ? await getUserById(decoded.uid) : null);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err: any) {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
});

// Email Verification - Request Code
app.post('/api/auth/send-verification-code', async (req, res) => {
  const { email, targetEmail, userId } = req.body;
  const rawEmail = targetEmail || email;
  if (!rawEmail || !rawEmail.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address (e.g. user@gmail.com)' });
  }

  const emailLower = rawEmail.toLowerCase().trim();
  const decoded = verifyCentralToken(req);

  let user = null;
  if (decoded) {
    user = await getUserById(decoded.uid) || await getUserProfile(decoded.email);
  }
  if (!user && userId) {
    user = await getUserById(userId);
  }
  if (!user && email) {
    user = await getUserProfile(email.toLowerCase().trim());
  }

  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  // Generate 6-digit verification code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await saveVerificationCode(emailLower, code);

  logTraffic('Central Auth', 'request', 'SSO Server', 'User Client', `Generated Email Verification OTP for ${emailLower} (User: ${user.uid})`);

  const emailResult = await sendVerificationEmail(emailLower, code, user.uid);
  res.json({
    success: emailResult.success,
    message: emailResult.message || `Verification code sent to ${emailLower}`,
    previewCode: emailResult.previewCode
  });
});

// Email Verification - Verify Code
app.post('/api/auth/verify-email-code', async (req, res) => {
  const { email, targetEmail, code, userId } = req.body;
  const rawEmail = targetEmail || email;
  if (!rawEmail || !code) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }

  const emailLower = rawEmail.toLowerCase().trim();
  const decoded = verifyCentralToken(req);

  let user = null;
  if (decoded) {
    user = await getUserById(decoded.uid) || await getUserProfile(decoded.email);
  }
  if (!user && userId) {
    user = await getUserById(userId);
  }
  if (!user && email) {
    user = await getUserProfile(email.toLowerCase().trim());
  }

  if (!user) {
    return res.status(404).json({ error: 'User account not found or expired' });
  }

  const codeRecord = await getVerificationCode(emailLower);
  if (!codeRecord || codeRecord.code !== code.trim()) {
    logTraffic('Central Auth', 'error', 'SSO Server', 'User Client', `Failed Email Verification for ${emailLower} (Invalid Code)`);
    return res.status(400).json({ error: 'Invalid or expired verification code. Please request a new code.' });
  }

  await deleteVerificationCode(emailLower);
  const updatedUser = await updateUserEmailAndVerification(user.uid, emailLower, true);

  logTraffic('Central Auth', 'success', 'SSO Server', 'User Client', `Email ${emailLower} successfully verified for user ${user.uid}`);
  res.json({
    verified: true,
    message: 'Email address verified successfully!',
    user: updatedUser || { ...user, email: emailLower, isEmailVerified: true }
  });
});

// Email Verification - Verify Code for Current Email during Email Change
app.post('/api/auth/verify-current-email-code', async (req, res) => {
  const { currentEmail, code, userId } = req.body;
  const rawEmail = currentEmail;
  if (!rawEmail || !code) {
    return res.status(400).json({ error: 'Current email and code are required' });
  }

  const emailLower = rawEmail.toLowerCase().trim();
  const codeRecord = await getVerificationCode(emailLower);
  if (!codeRecord || codeRecord.code !== code.trim()) {
    return res.status(400).json({ error: 'Invalid or expired verification code. Please request a new code.' });
  }

  await deleteVerificationCode(emailLower);
  res.json({
    success: true,
    authorized: true,
    message: 'Current email verified! You may now enter your new email address.'
  });
});

// Account Recovery via Master Recovery Code - Revoke All Old Passkeys & Notify Linked Email
app.post('/api/auth/verify-recovery-code', async (req, res) => {
  const { recoveryCode, identifier } = req.body;
  if (!recoveryCode) {
    return res.status(400).json({ error: 'Master Recovery Code is required for account recovery' });
  }

  // Lookup user by Master Recovery Code (and optional identifier)
  const user = await findUserByRecoveryCode(identifier || '', recoveryCode);
  if (!user) {
    logTraffic('Central Auth', 'error', 'SSO Server', 'User Client', `Failed Recovery Attempt with invalid code`);
    return res.status(404).json({ error: 'Invalid Master Recovery Code. Please double check the code you entered.' });
  }

  // 🔒 CRITICAL SECURITY STEP: Delete/Revoke ALL old passkeys registered for this account!
  const revokedCount = await clearUserAuthenticators(user.username || user.email);
  logTraffic('Central Auth', 'warning', 'SSO Server', 'User Client', `ACCOUNT RECOVERY: Master Recovery Code verified for ${user.username}. Revoked ${revokedCount} old passkey(s).`);

  // 🔒 SINGLE-USE RECOVERY CODE: Invalidate current code & generate brand new recovery code!
  const newRecoveryCode = await regenerateUserRecoveryCode(user.username);
  logTraffic('Central Auth', 'info', 'SSO Server', 'User Client', `Single-use recovery code consumed for ${user.username}. Generated new recovery code.`);

  // Notify linked email address about recovery execution
  if (user.email && user.email.includes('@')) {
    sendVerificationEmail(user.email, 'RECOVERED', user.uid).catch(err => console.error('Error sending alert email:', err));
  }

  const updatedUser = await getUserProfile(user.username);

  // Issue central session token
  const { accessToken, refreshToken, expiresIn } = issueCentralTokens(updatedUser || user);
  setCentralRefreshTokenCookie(res, refreshToken);

  res.json({
    success: true,
    token: accessToken,
    refreshToken,
    expiresIn,
    user: updatedUser || { ...user, recoveryCode: newRecoveryCode },
    newRecoveryCode,
    revokedCount,
    message: `Account recovered successfully! ${revokedCount > 0 ? `${revokedCount} old passkey(s) permanently deleted.` : ''} Your single-use recovery code has been consumed and a new code generated.`
  });
});

// Get user registered passkeys
app.post('/api/user/passkeys', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await getUserProfile(decoded.username || decoded.email || '');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const authenticators = await getUserAuthenticators(user.username);
  const passkeys = authenticators.map(auth => ({
    credentialID: auth.credentialID,
    username: auth.username,
    email: auth.email,
    userId: auth.userId,
    deviceName: auth.deviceName || 'Passkey Authenticator',
    authenticatorType: auth.authenticatorType || 'Platform Passkey',
    transports: auth.transports || [],
    createdAt: auth.createdAt || new Date().toISOString(),
    lastUsedAt: auth.lastUsedAt || auth.createdAt || new Date().toISOString(),
    counter: auth.counter || 0
  }));

  res.json({ passkeys });
});

// Get User Recovery Code
app.post('/api/user/recovery-code', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await getUserProfile(decoded.username || decoded.email || '');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ recoveryCode: user.recoveryCode });
});

// Regenerate User Recovery Code
app.post('/api/user/recovery-code/regenerate', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await getUserProfile(decoded.username || decoded.email || '');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const newCode = await regenerateUserRecoveryCode(user.username);
  logTraffic('Central Auth', 'warning', 'SSO Server', 'User Client', `Regenerated recovery code for ${user.username}`);

  res.json({
    success: true,
    recoveryCode: newCode,
    message: 'New recovery code generated successfully. Old code is now invalid.'
  });
});

// Delete / Revoke a specific passkey
app.delete('/api/user/passkeys/:credentialID', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { credentialID } = req.params;
  if (!credentialID) {
    return res.status(400).json({ error: 'Credential ID required' });
  }

  const user = await getUserProfile(decoded.username || decoded.email || '');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const authenticators = await getUserAuthenticators(user.username);
  const targetAuth = authenticators.find(a => a.credentialID === credentialID);

  if (!targetAuth) {
    return res.status(404).json({ error: 'Passkey not found for this account' });
  }

  // Requirement 8: Enforce at least 1 passkey remains registered
  const delResult = await deleteAuthenticator(credentialID, user.username);
  if (!delResult.success) {
    return res.status(400).json({ error: delResult.error || 'Cannot delete passkey' });
  }

  logTraffic('Central Auth', 'warning', 'SSO Server', 'User Client', `Deleted passkey ${credentialID} for ${user.username}`);

  const remaining = await getUserAuthenticators(user.username);
  res.json({
    success: true,
    message: 'Passkey deleted successfully',
    remainingCount: remaining.length
  });
});

// QR Code Login - Generate Session
app.post('/api/auth/qr/generate', async (req, res) => {
  const qrSessionId = 'qr_' + crypto.randomBytes(16).toString('hex');
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000').split(',')[0].trim();
  const protocol = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const qrUrl = `${protocol}://${host}/?qrSession=${qrSessionId}`;

  const userAgent = (req.headers['user-agent'] as string) || 'Laptop Browser';
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';

  const session = await createQrSession(qrSessionId, qrUrl, ip, userAgent);
  res.json({
    qrSessionId: session.qrSessionId,
    qrUrl: session.qrUrl,
    expiresAt: session.expiresAt
  });
});

// QR Code Login - Check Status
app.get('/api/auth/qr/status', async (req, res) => {
  const { qrSessionId } = req.query;
  if (!qrSessionId || typeof qrSessionId !== 'string') {
    return res.status(400).json({ error: 'QR Session ID required' });
  }

  const session = await getQrSession(qrSessionId);
  if (!session) {
    return res.status(404).json({ status: 'not_found' });
  }

  if (session.status === 'approved' && session.user && session.token) {
    return res.json({
      status: 'approved',
      user: session.user,
      token: session.token
    });
  }

  res.json({ status: session.status });
});

// QR Code Login - Approve from mobile device
app.post('/api/auth/qr/approve', async (req, res) => {
  const { qrSessionId } = req.body;
  if (!qrSessionId) {
    return res.status(400).json({ error: 'QR Session ID required' });
  }

  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'You must be signed in on this device to approve QR login.' });
  }

  const user = (decoded.username ? await getUserProfile(decoded.username) : null) ||
               (decoded.email ? await getUserProfile(decoded.email) : null) ||
               (decoded.uid ? await getUserById(decoded.uid) : null);
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  // Issue token for the new laptop session
  const tokens = issueCentralTokens(user);

  const approved = await approveQrSession(qrSessionId, user, tokens.accessToken);
  if (!approved) {
    return res.status(400).json({ error: 'QR session expired or invalid' });
  }

  // Record QR active session for laptop
  const newSessionId = 'sess_' + crypto.randomBytes(16).toString('hex');
  await createActiveSession(
    newSessionId,
    user.username || user.email,
    'Laptop (QR Login)',
    req.headers['user-agent'] || 'Remote Device',
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1',
    'qr_code'
  );

  logTraffic('Central Auth', 'success', 'SSO Server', 'Mobile Client', `Approved QR Login ${qrSessionId} for ${user.username || user.email}`);

  res.json({
    success: true,
    message: 'QR Code Login approved successfully!'
  });
});

// Get User Active Sessions
app.post('/api/user/active-sessions', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await getUserProfile(decoded.username || decoded.email || '');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const sessions = await getUserActiveSessions(user.username);
  res.json({ sessions });
});

// Revoke User Active Session
app.post('/api/user/revoke-session', async (req, res) => {
  const decoded = verifyCentralToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { sessionId, currentSessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  // Requirement 7: Cannot revoke current active session
  if (currentSessionId && sessionId === currentSessionId) {
    return res.status(400).json({ error: 'Cannot revoke current active session.' });
  }

  const username = decoded.username || decoded.email || '';
  await revokeActiveSession(sessionId, username);
  logTraffic('Central Auth', 'warning', 'SSO Server', 'User Client', `Revoked active session ${sessionId} for ${username}`);

  const sessions = await getUserActiveSessions(username);
  res.json({
    success: true,
    message: 'Session revoked successfully',
    sessions
  });
});

// Email Verification - Status Check
app.get('/api/auth/verification-status', async (req, res) => {
  const identifier = (req.query.username || req.query.email) as string;
  if (!identifier) {
    return res.status(400).json({ error: 'Username or email parameter required' });
  }

  const user = await getUserProfile(identifier);

  if (!user) {
    return res.status(404).json({
      accountDeleted: true,
      message: 'Account deleted or not found. (Accounts unverified after 7 days are automatically removed)'
    });
  }

  res.json({
    user,
    isEmailVerified: !!user.isEmailVerified,
    createdAt: user.createdAt,
    verificationDeadline: user.verificationDeadline,
    now: new Date().toISOString()
  });
});

// Token Refresh Endpoint (Reads HttpOnly cookie or body, verifies JWT, issues new access token & rotates refresh token)
const handleTokenRefresh = async (req: express.Request, res: express.Response) => {
  const refreshToken = req.cookies?.sasso_refresh_token || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token provided in HttpOnly cookie' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;
    if (decoded.type !== 'central_sso_refresh' || (!decoded.username && !decoded.email)) {
      clearCentralRefreshTokenCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token type' });
    }

    const { familyId, username, email, uid } = decoded;

    // Retrieve user profile from DB
    const user = await getUserProfile(username || email || uid) || (uid ? await getUserById(uid) : null);
    if (!user) {
      clearCentralRefreshTokenCookie(res);
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Issue new token pair and refresh cookie
    const tokens = issueCentralTokens(user, familyId);
    setCentralRefreshTokenCookie(res, tokens.refreshToken);

    logTraffic('Token Rotation', 'success', 'SSO Server', 'User Client', `Refreshed tokens for ${user.username}`);

    res.json({
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user
    });
  } catch (err: any) {
    clearCentralRefreshTokenCookie(res);
    logTraffic('Token Rotation', 'error', 'SSO Server', 'User Client', `Refresh token verification failed: ${err.message}`);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

app.post('/api/sso/refresh', handleTokenRefresh);
app.get('/api/sso/refresh', handleTokenRefresh);

// Central Logout Endpoint - Clears HttpOnly Cookie & Deletes Active Sessions + Refresh Tokens from DB
app.post('/api/sso/logout', async (req, res) => {
  const refreshToken = req.cookies?.sasso_refresh_token || req.body?.refreshToken;
  const decoded = verifyCentralToken(req) || (refreshToken ? jwt.decode(refreshToken) : null) as any;
  const username = decoded?.username || decoded?.email || req.body?.username || req.body?.email;

  if (username) {
    await removeAllUserSessions(username);
    await revokeAllUserRefreshTokens(username);
  }

  clearCentralRefreshTokenCookie(res);
  res.json({ success: true, message: 'Logged out successfully and all active sessions/tokens deleted from DB' });
});


// STEP 1 of OAuth/OIDC Flow: Authorize App & issue an Authorization Code
app.post('/api/sso/authorize', async (req, res) => {
  const { centralToken, clientId, redirectUri, accessType, access_type } = req.body;
  const rawAccessType = access_type || accessType || req.query.access_type || req.query.accessType;
  const requestedAccessType = rawAccessType === 'online' ? 'online' : 'offline';

  const state = req.body.state || req.query.state;
  const nonce = req.body.nonce || req.query.nonce;
  const codeChallenge = req.body.code_challenge || req.body.codeChallenge || req.query.code_challenge || req.query.codeChallenge;
  const codeChallengeMethod = req.body.code_challenge_method || req.body.codeChallengeMethod || req.query.code_challenge_method || req.query.codeChallengeMethod || (codeChallenge ? 'S256' : undefined);

  if (!centralToken || !clientId || !redirectUri) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // 1. Verify that user is signed into the central SSO
    const decoded = jwt.verify(centralToken, JWT_SECRET) as any;
    if (decoded.type !== 'central_sso') {
      return res.status(400).json({ error: 'Invalid central token' });
    }

    const user = await getUserById(decoded.uid);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Validate client application details
    const apps = await getClientApps();
    const targetApp = apps.find(app => app.id === clientId);
    if (!targetApp) {
      logTraffic('OIDC/OAuth2', 'error', 'App Client', 'SSO Server', `Authorization failed: App ID '${clientId}' not found.`);
      return res.status(400).json({ error: 'Client application not found' });
    }

    // 3. Issue a secure, 2-minute short-lived authorization code with stored PKCE, state, nonce & accessType
    const code = await createAuthorizationCode(user.uid, clientId, redirectUri, requestedAccessType, {
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod
    });
    await addAuthorizedApp(user.username, clientId);

    logTraffic('OIDC/OAuth2', 'success', 'SSO Server', `${targetApp.name}`, `Issued short-lived auth code (2 min expiry, PKCE: ${codeChallenge ? 'YES' : 'NO'}, state: ${state ? 'YES' : 'NO'}, nonce: ${nonce ? 'YES' : 'NO'}) for user ${user.username}`, {
      code,
      clientId,
      redirectUri,
      accessType: requestedAccessType,
      state,
      nonce,
      codeChallengeMethod
    });

    res.json({ code, ...(state ? { state } : {}) });
  } catch (err: any) {
    logTraffic('OIDC/OAuth2', 'error', 'SSO Server', 'App Client', `Auth flow failed: ${err.message}`);
    res.status(401).json({ error: 'Unauthorized central session' });
  }
});

// Get User's Connected / Authorized Applications ("Signin with SASSO" apps)
app.post('/api/user/authorized-apps', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.type !== 'central_sso') {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const apps = await getUserAuthorizedApps(decoded.email);
    res.json({ apps });
  } catch (err: any) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Revoke User Authorization for a Client App
app.post('/api/user/revoke-app', async (req, res) => {
  const { token, clientId } = req.body;
  if (!token || !clientId) {
    return res.status(400).json({ error: 'Token and clientId required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.type !== 'central_sso') {
      return res.status(400).json({ error: 'Invalid token' });
    }

    await revokeUserAuthorizedApp(decoded.email, clientId);
    logTraffic('Central Auth', 'event', 'User Profile', 'SSO Server', `User ${decoded.email} revoked authorization for app ID: ${clientId}`);

    const updatedApps = await getUserAuthorizedApps(decoded.email);
    res.json({ success: true, apps: updatedApps });
  } catch (err: any) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// STEP 2 of OAuth/OIDC Flow: Token Endpoint (Authorization Code Exchange or Refresh Token Exchange)
app.post('/api/sso/token', async (req, res) => {
  const { grant_type = 'authorization_code', code, clientId: rawClientId, client_id, clientSecret: rawClientSecret, client_secret, refreshToken: rawRefreshToken, refresh_token, code_verifier: rawCodeVerifier, codeVerifier: altCodeVerifier } = req.body;

  const clientId = rawClientId || client_id;
  const clientSecret = rawClientSecret || client_secret;
  const codeVerifier = rawCodeVerifier || altCodeVerifier;

  if (!clientId) {
    return res.status(400).json({ error: 'Missing client_id parameter' });
  }

  // Validate Client App Credentials first
  const appsForToken = await getClientApps();
  const targetApp = appsForToken.find(app => app.id === clientId);
  if (!targetApp) {
    logTraffic('OIDC/OAuth2', 'error', 'SSO Server', `${clientId}`, `Token endpoint failed: Invalid client_id`);
    return res.status(400).json({ error: 'Invalid client_id: Application not found' });
  }

  // Verify client secret if provided or if grant_type is refresh_token
  if (grant_type === 'refresh_token' || (clientSecret && targetApp.clientSecret !== clientSecret)) {
    if (targetApp.clientSecret !== clientSecret) {
      logTraffic('OIDC/OAuth2', 'error', 'SSO Server', `${clientId}`, `Token endpoint failed: Invalid client_id or client_secret mismatch`);
      return res.status(400).json({ error: 'Invalid client credentials or client secret mismatch' });
    }
  }

  try {
    // ---- MODE A: grant_type = 'refresh_token' ----
    if (grant_type === 'refresh_token') {
      const incomingRefreshToken = rawRefreshToken || refresh_token;
      if (!incomingRefreshToken) {
        return res.status(400).json({ error: 'Missing refresh_token parameter' });
      }

      // 1. Verify JWT signature first
      let decoded: any;
      try {
        decoded = jwt.verify(incomingRefreshToken, JWT_SECRET) as any;
      } catch (err: any) {
        logTraffic('OIDC/OAuth2', 'error', 'SSO Server', `${clientId}`, `Refresh token verification failed: ${err.message}`);
        return res.status(400).json({ error: 'Invalid or expired refresh token' });
      }

      if (decoded.clientId !== clientId || decoded.type !== `app_refresh_${clientId}`) {
        return res.status(400).json({ error: 'Invalid refresh_token scope or token type' });
      }

      // 2. Check Database for token record (Reuse Detection)
      let existingTokenRecord = await findRefreshToken(incomingRefreshToken);
      if (!existingTokenRecord) {
        // Fallback for valid JWT tokens issued before DB persistence was added or across server restarts
        const expMs = (decoded.exp ? decoded.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000);
        if (expMs > Date.now()) {
          await saveRefreshToken(incomingRefreshToken, decoded.uid, decoded.email, clientId, expMs);
          existingTokenRecord = await findRefreshToken(incomingRefreshToken);
        }
      }

      if (!existingTokenRecord) {
        // TOKEN REUSE DETECTION TRIGGERED!
        // The token has valid signature but is NOT in DB -> already used/rotated or revoked!
        logTraffic('OIDC/OAuth2', 'error', 'SSO Server', `${targetApp.name}`, `SECURITY ALERT: Refresh token reuse detected for user ${decoded.email}! Revoking all refresh tokens for client ${clientId}.`);
        await revokeAllUserClientRefreshTokens(decoded.uid, clientId);
        return res.status(401).json({ error: 'Refresh token has been revoked or previously used (Reuse Attempt Detected)' });
      }

      const user = await getUserById(decoded.uid) || await getUserProfile(decoded.email);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // 3. Delete old refresh token from DB (Token Rotation)
      await deleteRefreshToken(incomingRefreshToken);

      // Issue new Access Token (2h)
      const newAppToken = jwt.sign(
        { uid: user.uid, email: user.email, clientId, type: `app_session_${clientId}` },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      // Issue new ID Token (2h)
      const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'localhost';
      const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
      const issuer = `${proto}://${hostHeader}`;

      const newIdToken = jwt.sign(
        {
          iss: issuer,
          sub: user.uid,
          aud: clientId,
          ...(user.email ? { email: user.email, email_verified: user.isEmailVerified || false } : {}),
          name: user.username,
          preferred_username: user.username,
          given_name: user.username,
          family_name: '',
          picture: user.avatarUrl,
          iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      // 4. Generate & Save Rotated Refresh Token (30d) in DB
      const rotatedRefreshToken = jwt.sign(
        { uid: user.uid, email: user.email, clientId, type: `app_refresh_${clientId}` },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      await saveRefreshToken(rotatedRefreshToken, user.uid, user.email, clientId, Date.now() + thirtyDaysMs, targetApp.name);

      logTraffic('OIDC/OAuth2', 'success', 'SSO Server', `${targetApp.name}`, `Refreshed App Tokens via Refresh Token Grant for ${user.email} (Rotated & Saved in DB)`, {
        newAccessPreview: newAppToken.substring(0, 20) + '...',
        userEmail: user.email
      });

      return res.json({
        access_token: newAppToken,
        id_token: newIdToken,
        refresh_token: rotatedRefreshToken,
        token_type: 'Bearer',
        expires_in: 7200,
        appToken: newAppToken,
        refreshToken: rotatedRefreshToken,
        user
      });
    }

    // ---- MODE B: grant_type = 'authorization_code' ----
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code parameter' });
    }

    const authCode = await exchangeAuthorizationCode(code, clientId, clientSecret, codeVerifier);
    if (!authCode) {
      logTraffic('OIDC/OAuth2', 'error', 'SSO Server', `${clientId}`, `Token exchange failed: Invalid code, expired (2m max), already used, or PKCE verifier mismatch`);
      return res.status(400).json({ error: 'Invalid or expired authorization code, or PKCE verifier mismatch' });
    }

    const user = await getUserById(authCode.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await addAuthorizedApp(user.email, clientId);

    // Generate App Access Token (valid for 2 hours)
    const appToken = jwt.sign(
      { uid: user.uid, email: user.email, clientId, type: `app_session_${clientId}` },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    // Generate OpenID Connect (OIDC) ID Token with optional nonce
    const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const issuer = `${proto}://${hostHeader}`;

    const idTokenClaims: any = {
      iss: issuer,
      sub: user.uid,
      aud: clientId,
      ...(user.email ? { email: user.email, email_verified: user.isEmailVerified || false } : {}),
      name: user.username,
      preferred_username: user.username,
      given_name: user.username,
      family_name: '',
      picture: user.avatarUrl,
      iat: Math.floor(Date.now() / 1000),
    };

    if (authCode.nonce) {
      idTokenClaims.nonce = authCode.nonce;
    }

    const idToken = jwt.sign(
      idTokenClaims,
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    // REFRESH TOKEN ISSUANCE & DB PERSISTENCE:
    // Issue & store refresh_token unless access_type was explicitly requested as 'online'
    const isOfflineAccess = authCode.accessType !== 'online';
    let appRefreshToken: string | undefined = undefined;

    if (isOfflineAccess) {
      appRefreshToken = jwt.sign(
        { uid: user.uid, email: user.email, clientId, type: `app_refresh_${clientId}` },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      await saveRefreshToken(appRefreshToken, user.uid, user.email, clientId, Date.now() + thirtyDaysMs, targetApp.name);
    }

    logTraffic('OIDC/OAuth2', 'success', 'SSO Server', `${targetApp.name}`, `Exchanged code for App Access Token & ID Token (PKCE: ${authCode.codeChallenge ? 'VERIFIED' : 'NONE'}, Nonce: ${authCode.nonce ? 'INCLUDED' : 'NONE'}, Refresh Token issued: ${isOfflineAccess ? 'YES' : 'NO'})`, {
      appTokenPreview: appToken.substring(0, 20) + '...',
      idTokenPreview: idToken.substring(0, 20) + '...',
      refreshTokenIssued: isOfflineAccess,
      userEmail: user.email,
      state: authCode.state
    });

    const tokenResponse: any = {
      access_token: appToken,
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 7200,
      appToken,
      user
    };

    if (authCode.state) {
      tokenResponse.state = authCode.state;
    }

    if (appRefreshToken) {
      tokenResponse.refresh_token = appRefreshToken;
      tokenResponse.refreshToken = appRefreshToken;
    }

    res.json(tokenResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Verify App-Specific Token (simulation of independent app backend verifying JWT)
app.post('/api/sso/verify-app-token', (req, res) => {
  const { token, clientId } = req.body;
  if (!token || !clientId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.clientId !== clientId || decoded.type !== `app_session_${clientId}`) {
      return res.status(400).json({ error: 'Invalid app-specific token scope' });
    }

    logTraffic('JWT Verify', 'success', `${clientId} Backend`, 'SSO Server', `JWT signature & scope verified for user: ${decoded.email}`);
    res.json({ valid: true, decoded });
  } catch (err: any) {
    logTraffic('JWT Verify', 'error', `${clientId} Backend`, 'SSO Server', `JWT signature verification failed: ${err.message}`);
    res.status(401).json({ error: 'Invalid or expired app token' });
  }
});

// Single Logout / SLO Session Invalidation (OIDC RP-Initiated Logout)
app.all('/api/sso/logout-slo', async (req, res) => {
  const email = req.body?.email || req.query?.email || 'User';
  const postLogoutRedirectUri = (req.query?.post_logout_redirect_uri || req.body?.post_logout_redirect_uri) as string;
  const state = (req.query?.state || req.body?.state) as string;

  const decoded = verifyCentralToken(req) as any;
  const username = decoded?.username || decoded?.email || email;

  if (username && username !== 'User') {
    await removeAllUserSessions(username);
    await revokeAllUserRefreshTokens(username);
  }

  clearCentralRefreshTokenCookie(res);
  logTraffic('Central Auth', 'event', 'SSO Central', 'Client App', `RP-Initiated Single Logout (SLO) requested for: ${username}`);

  // If client app provided a post_logout_redirect_uri, redirect browser back to client app!
  if (postLogoutRedirectUri) {
    let redirectUrl = postLogoutRedirectUri;
    if (state) {
      redirectUrl += (redirectUrl.includes('?') ? '&' : '?') + `state=${encodeURIComponent(state)}`;
    }
    logTraffic('Central Auth', 'success', 'SSO Central', 'Client App', `Redirecting user back to client app: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  }

  // Fallback JSON response for API calls
  res.json({ success: true, message: 'SLO triggered successfully. All active sessions and refresh tokens deleted from DB.' });
});

// ------------------ FRONTEND & VITE MIDDLEWARE ------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 sasso - SSO Core Server running on http://localhost:${PORT}`);
  });
}

startServer();
