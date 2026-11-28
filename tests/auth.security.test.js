process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-super-strong-jwt-secret-key-at-least-32-chars';
process.env.FRONTEND_URL = 'http://localhost:5173';
delete process.env.REDIS_URL;
delete process.env.BREVO_USER;
delete process.env.BREVO_PASS;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const dbModule = require('../server/shared/db');
const passwordService = require('../server/shared/passwordService');
const tokenService = require('../server/shared/tokenService');
const mailService = require('../server/shared/mailService');
const cloudflareService = require('../server/shared/cloudflareService');
const axios = require('axios');

// Intercept outbound emails in tests without touching real SMTP while capturing reset links for E2E reset-token verification
const capturedEmails = [];
const originalSendMail = mailService.sendMail;
mailService.sendMail = async (opts) => {
  capturedEmails.push(opts);
  return { success: true, messageId: `test-msg-${capturedEmails.length}` };
};
// Ensure auth router uses the patched sendPasswordResetEmail / sendPasswordChangedEmail
const sendMailHelperModule = require.cache[require.resolve('../server/shared/mailService')];
sendMailHelperModule.exports.sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  capturedEmails.push({ type: 'reset', to, name, resetUrl });
  return { success: true, messageId: `test-reset-${capturedEmails.length}` };
};
sendMailHelperModule.exports.sendPasswordChangedEmail = async ({ to, name }) => {
  capturedEmails.push({ type: 'changed', to, name });
  return { success: true, messageId: `test-changed-${capturedEmails.length}` };
};

// In-memory PostgreSQL/Prisma relational store preserving uniqueness, select projections, and transactions
function createInMemoryPrisma() {
  const store = {
    users: [],
    refreshTokens: [],
    passwordResetTokens: [],
    authAuditLogs: [],
    agentWorkLogs: [],
  };

  function applySelect(row, select) {
    if (!row) return null;
    if (!select) return { ...row };
    const out = {};
    for (const [k, v] of Object.entries(select)) {
      if (v) out[k] = row[k] !== undefined ? row[k] : null;
    }
    return out;
  }

  function matchWhere(row, where = {}) {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR' && Array.isArray(v)) {
        if (!v.some((sub) => matchWhere(row, sub))) return false;
        continue;
      }
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if (v.equals !== undefined) {
          const a = row[k] || '';
          const b = v.equals || '';
          if (v.mode === 'insensitive') {
            if (String(a).toLowerCase() !== String(b).toLowerCase()) return false;
          } else if (a !== b) return false;
          continue;
        }
        if (v.not !== undefined && row[k] === v.not) return false;
        if (v.in !== undefined && !v.in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  function applyData(row, data) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && v.increment !== undefined) {
        next[k] = (next[k] || 0) + v.increment;
      } else {
        next[k] = v;
      }
    }
    next.updatedAt = new Date();
    return next;
  }

  const prismaMock = {
    user: {
      findFirst: async ({ where, select } = {}) => {
        const found = store.users.find((u) => matchWhere(u, where));
        return applySelect(found, select);
      },
      findUnique: async ({ where, select } = {}) => {
        const found = store.users.find((u) => matchWhere(u, where));
        return applySelect(found, select);
      },
      findMany: async ({ where, select } = {}) => {
        return store.users.filter((u) => matchWhere(u, where)).map((u) => applySelect(u, select));
      },
      create: async ({ data, select }) => {
        if (store.users.some((u) => u.username === data.username || (data.email && u.email === data.email))) {
          const err = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = {
          id: crypto.randomUUID(),
          email: null,
          tlId: null,
          adminId: null,
          receiverMail: null,
          smtpGmail: null,
          smtpPassword: null,
          active: true,
          isDeleted: false,
          tokenVersion: 0,
          passwordChangedAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.users.push(row);
        return applySelect(row, select);
      },
      update: async ({ where, data, select }) => {
        const idx = store.users.findIndex((u) => matchWhere(u, where));
        if (idx === -1) throw new Error('Record not found');
        store.users[idx] = applyData(store.users[idx], data);
        return applySelect(store.users[idx], select);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        store.users = store.users.map((u) => {
          if (matchWhere(u, where)) {
            count += 1;
            return applyData(u, data);
          }
          return u;
        });
        return { count };
      },
      deleteMany: async ({ where }) => {
        const before = store.users.length;
        store.users = store.users.filter((u) => !matchWhere(u, where));
        return { count: before - store.users.length };
      },
    },
    refreshToken: {
      findUnique: async ({ where, include } = {}) => {
        const found = store.refreshTokens.find((t) => matchWhere(t, where));
        if (!found) return null;
        const out = { ...found };
        if (include?.user) {
          const u = store.users.find((user) => user.id === found.userId);
          out.user = applySelect(u, include.user.select);
        }
        return out;
      },
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), revokedAt: null, replacedByTokenHash: null, createdAt: new Date(), ...data };
        store.refreshTokens.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const idx = store.refreshTokens.findIndex((t) => matchWhere(t, where));
        if (idx === -1) throw new Error('RefreshToken not found');
        store.refreshTokens[idx] = { ...store.refreshTokens[idx], ...data };
        return { ...store.refreshTokens[idx] };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        store.refreshTokens = store.refreshTokens.map((t) => {
          if (matchWhere(t, where)) {
            count += 1;
            return { ...t, ...data };
          }
          return t;
        });
        return { count };
      },
    },
    passwordResetToken: {
      findUnique: async ({ where, include } = {}) => {
        const found = store.passwordResetTokens.find((t) => matchWhere(t, where));
        if (!found) return null;
        const out = { ...found };
        if (include?.user) {
          const u = store.users.find((user) => user.id === found.userId);
          out.user = applySelect(u, include.user.select);
        }
        return out;
      },
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), usedAt: null, createdAt: new Date(), ...data };
        store.passwordResetTokens.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const idx = store.passwordResetTokens.findIndex((t) => matchWhere(t, where));
        if (idx === -1) throw new Error('ResetToken not found');
        store.passwordResetTokens[idx] = { ...store.passwordResetTokens[idx], ...data };
        return { ...store.passwordResetTokens[idx] };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        store.passwordResetTokens = store.passwordResetTokens.map((t) => {
          if (matchWhere(t, where)) {
            count += 1;
            return { ...t, ...data };
          }
          return t;
        });
        return { count };
      },
    },
    authAuditLog: {
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), createdAt: new Date(), ...data };
        store.authAuditLogs.push(row);
        return row;
      },
    },
    agentWorkLog: {
      findMany: async ({ where } = {}) => store.agentWorkLogs.filter((l) => matchWhere(l, where)),
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), lunchDuration: 0, bioDuration: 0, teaDuration: 0, logoutAt: null, ...data };
        store.agentWorkLogs.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const idx = store.agentWorkLogs.findIndex((l) => matchWhere(l, where));
        if (idx >= 0) store.agentWorkLogs[idx] = { ...store.agentWorkLogs[idx], ...data };
        return store.agentWorkLogs[idx];
      },
    },
    contact: {
      findMany: async () => [],
      count: async () => 0,
    },
    $transaction: async (ops) => Promise.all(ops),
    __store: store,
  };

  return prismaMock;
}

const mockPrisma = createInMemoryPrisma();
dbModule.prisma = mockPrisma;
require.cache[require.resolve('../server/shared/db')].exports.prisma = mockPrisma;

const { createApp } = require('../server/server');
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_SITE_KEY;

async function startTestServer() {
  const { server } = createApp({ enableRedisAdapter: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

function parseSetCookies(setCookieHeaders = []) {
  const jar = {};
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const name = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      jar[name] = val;
    }
  }
  return jar;
}

async function requestJson(baseUrl, path, { method = 'GET', body, headers = {}, cookies = {} } = {}) {
  const cookieHeader = Object.entries(cookies)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawSetCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const nextCookies = parseSetCookies(rawSetCookies);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, cookies: nextCookies, headers: res.headers };
}

test('1-2. Argon2id hashing produces encoded Argon2id hashes with unique salts and rejects wrong passwords', async () => {
  const plain = 'Str0ng!Pass#2026';
  const hash1 = await passwordService.hashPassword(plain);
  const hash2 = await passwordService.hashPassword(plain);

  assert.match(hash1, /^\$argon2id\$/);
  assert.match(hash2, /^\$argon2id\$/);
  assert.notEqual(hash1, plain);
  assert.notEqual(hash1, hash2, 'Identical passwords must produce distinct hashes via unique salts');

  const ok = await passwordService.verifyPassword(plain, hash1);
  assert.equal(ok.valid, true);
  assert.equal(ok.needsRehash, false);

  const bad = await passwordService.verifyPassword('WrongPass!123', hash1);
  assert.equal(bad.valid, false);
});

test('3-13. End-to-end auth security workflows: registration, login, bcrypt upgrade, RBAC, reset tokens, refresh rotation, rate limits', async () => {
  const { server, baseUrl } = await startTestServer();
  let ipCounter = 10;
  const nextIp = () => `10.0.0.${++ipCounter}`;

  try {
    // A. Registration enforces password rules, normalizes email, blocks privilege escalation, stores only Argon2id hash
    const weakReg = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { name: 'Alice Agent', email: 'Alice@Example.COM', password: 'weak', role: 'superadmin' },
    });
    assert.equal(weakReg.status, 400);

    const regRes = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: {
        name: 'Alice Agent',
        email: '  Alice@Example.COM ',
        password: 'Alice!Secure99',
        role: 'superadmin', // Attempt privilege escalation via mass assignment
        adminId: 'hijacked-admin',
      },
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.data.user.email, 'alice@example.com');
    assert.equal(regRes.data.user.role, 'agent', 'Self-registration must never allow role escalation');
    assert.equal(regRes.data.user.adminId, null);
    assert.equal(regRes.data.user.passwordHash, undefined);
    assert.equal(regRes.data.user.password, undefined);

    const storedAlice = mockPrisma.__store.users.find((u) => u.email === 'alice@example.com');
    assert.ok(storedAlice);
    assert.match(storedAlice.passwordHash, /^\$argon2id\$/);
    assert.equal(storedAlice.password, undefined);

    // Duplicate registration rejected
    const dupReg = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { name: 'Alice Two', email: 'ALICE@example.com', password: 'Alice!Secure99' },
    });
    assert.equal(dupReg.status, 409);

    // B. Wrong password & nonexistent user both return generic 401 without revealing email existence
    const badLogin1 = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'alice@example.com', password: 'Wrong!Password1' },
    });
    const badLogin2 = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'nonexistent@example.com', password: 'Wrong!Password1' },
    });
    assert.equal(badLogin1.status, 401);
    assert.equal(badLogin2.status, 401);
    assert.equal(badLogin1.data.error, badLogin2.data.error);

    // C. Successful login sets HttpOnly cookies + CSRF cookie and returns sanitized user
    const loginRes = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'ALICE@EXAMPLE.COM', password: 'Alice!Secure99' },
    });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.cookies.crm_access_token);
    assert.ok(loginRes.cookies.crm_refresh_token);
    assert.ok(loginRes.cookies.crm_csrf);
    assert.equal(loginRes.data.csrfToken, loginRes.cookies.crm_csrf);
    assert.equal(loginRes.data.user.passwordHash, undefined);

    const csrfEndpointRes = await requestJson(baseUrl, '/api/auth/csrf-token');
    assert.equal(csrfEndpointRes.status, 200);
    assert.ok(csrfEndpointRes.data.csrfToken);
    assert.equal(csrfEndpointRes.data.csrfToken, csrfEndpointRes.cookies.crm_csrf);

    let aliceCookies = { ...loginRes.cookies };

    // D. Unauthenticated access to protected APIs is rejected; /auth/session stays non-erroring
    const unauthSession = await requestJson(baseUrl, '/api/auth/session');
    assert.equal(unauthSession.status, 200);
    assert.equal(unauthSession.data.authenticated, false);
    assert.ok(unauthSession.data.csrfToken);

    const unauthMe = await requestJson(baseUrl, '/api/auth/me');
    const unauthUsers = await requestJson(baseUrl, '/api/users');
    const unauthMail = await requestJson(baseUrl, '/api/mail/send', { method: 'POST', body: { to: 'a@b.com' } });
    const unauthAlerts = await requestJson(baseUrl, '/api/notifications/alerts?userId=123');
    assert.equal(unauthMe.status, 401);
    assert.equal(unauthUsers.status, 401);
    assert.equal(unauthMail.status, 401);
    assert.equal(unauthAlerts.status, 401);

    // E. Authenticated /api/auth/me works with cookies; RBAC prevents agent from accessing /api/users
    const meRes = await requestJson(baseUrl, '/api/auth/me', { cookies: aliceCookies });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.email, 'alice@example.com');
    assert.equal(meRes.data.csrfToken, aliceCookies.crm_csrf);
    assert.ok(meRes.data.accessToken);
    assert.equal(meRes.data.user.passwordHash, undefined);

    const authSession = await requestJson(baseUrl, '/api/auth/session', { cookies: aliceCookies });
    assert.equal(authSession.status, 200);
    assert.equal(authSession.data.authenticated, true);
    assert.equal(authSession.data.user.email, 'alice@example.com');
    assert.ok(authSession.data.accessToken);

    const forbiddenUsers = await requestJson(baseUrl, '/api/users', { cookies: aliceCookies });
    assert.equal(forbiddenUsers.status, 403);

    // F. CSRF protection blocks cookie-authenticated POST without X-CSRF-Token
    const csrfFail = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookies: aliceCookies,
      body: { currentPassword: 'Alice!Secure99', newPassword: 'Alice!NewPass88' },
    });
    assert.equal(csrfFail.status, 403);

    // G. Refresh token rotation & reuse detection
    const refresh1 = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      cookies: aliceCookies,
      headers: { 'X-CSRF-Token': aliceCookies.crm_csrf },
    });
    assert.equal(refresh1.status, 200);
    assert.equal(refresh1.data.csrfToken, refresh1.cookies.crm_csrf);
    assert.notEqual(refresh1.cookies.crm_refresh_token, aliceCookies.crm_refresh_token);

    // Replaying the old rotated refresh token triggers family revocation!
    const replayRes = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      cookies: aliceCookies,
      headers: { 'X-CSRF-Token': aliceCookies.crm_csrf },
    });
    assert.equal(replayRes.status, 401);

    // Even the newly rotated token from that compromised family is now revoked
    const revokedFamilyAttempt = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      cookies: refresh1.cookies,
      headers: { 'X-CSRF-Token': refresh1.cookies.crm_csrf },
    });
    assert.equal(revokedFamilyAttempt.status, 401);

    // Re-login Alice for change-password test
    const relogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'alice@example.com', password: 'Alice!Secure99' },
    });
    aliceCookies = { ...relogin.cookies };
    const oldAccessToken = relogin.data.accessToken;

    // H. Change password requires current password, rejects wrong current password, updates hash & invalidates old JWT
    const badChange = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookies: aliceCookies,
      headers: { 'X-CSRF-Token': aliceCookies.crm_csrf },
      body: { currentPassword: 'WrongCurrent!1', newPassword: 'Alice!NewPass88' },
    });
    assert.equal(badChange.status, 401);

    const goodChange = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookies: aliceCookies,
      headers: { 'X-CSRF-Token': aliceCookies.crm_csrf },
      body: { currentPassword: 'Alice!Secure99', newPassword: 'Alice!NewPass88' },
    });
    assert.equal(goodChange.status, 200);
    aliceCookies = { ...goodChange.cookies };

    // Old JWT issued before password change is immediately rejected due to tokenVersion increment
    const oldJwtRes = await requestJson(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${oldAccessToken}` },
    });
    assert.equal(oldJwtRes.status, 401);

    // I. Forgot password returns generic response for both unknown and known emails, stores only hashed token
    const forgotUnknown = await requestJson(baseUrl, '/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'nobody@example.com' },
    });
    const forgotKnown = await requestJson(baseUrl, '/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'alice@example.com' },
    });
    assert.equal(forgotUnknown.status, 200);
    assert.equal(forgotKnown.status, 200);
    assert.equal(forgotUnknown.data.message, forgotKnown.data.message);

    const resetMail = capturedEmails.find((m) => m.type === 'reset' && m.to === 'alice@example.com');
    assert.ok(resetMail);
    const rawResetToken = decodeURIComponent(new URL(resetMail.resetUrl).searchParams.get('token'));
    assert.ok(rawResetToken.length >= 32);

    const storedResetRow = mockPrisma.__store.passwordResetTokens[0];
    assert.notEqual(storedResetRow.tokenHash, rawResetToken, 'Reset token must be hashed at rest');
    assert.equal(storedResetRow.tokenHash, tokenService.hashToken(rawResetToken));

    // Expired reset token is rejected
    const expiredRaw = tokenService.generateOpaqueToken(32);
    await mockPrisma.passwordResetToken.create({
      data: {
        userId: storedAlice.id,
        tokenHash: tokenService.hashToken(expiredRaw),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expiredReset = await requestJson(baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { token: expiredRaw, newPassword: 'Alice!ResetPass99' },
    });
    assert.equal(expiredReset.status, 400);

    // Valid reset succeeds and replaces hash
    const hashBeforeReset = mockPrisma.__store.users.find((u) => u.id === storedAlice.id).passwordHash;
    const validReset = await requestJson(baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { token: rawResetToken, newPassword: 'Alice!ResetPass99' },
    });
    assert.equal(validReset.status, 200);
    const hashAfterReset = mockPrisma.__store.users.find((u) => u.id === storedAlice.id).passwordHash;
    assert.notEqual(hashAfterReset, hashBeforeReset);

    // Reset token cannot be reused
    const reuseReset = await requestJson(baseUrl, '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { token: rawResetToken, newPassword: 'Alice!Another99' },
    });
    assert.equal(reuseReset.status, 400);

    // Old password no longer logs in; new reset password works
    const oldPassAttempt = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'alice@example.com', password: 'Alice!NewPass88' },
    });
    assert.equal(oldPassAttempt.status, 401);

    const newPassLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'alice@example.com', password: 'Alice!ResetPass99' },
    });
    assert.equal(newPassLogin.status, 200);

    // J. Legacy bcrypt user transparently upgrades to Argon2id on successful login
    const legacyBcryptHash = await bcrypt.hash('Legacy!User77', 10);
    const legacyUser = await mockPrisma.user.create({
      data: {
        username: 'legacy@example.com',
        email: 'legacy@example.com',
        passwordHash: legacyBcryptHash,
        name: 'Legacy User',
        role: 'agent',
        active: true,
        isDeleted: false,
      },
    });
    const legacyLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'legacy@example.com', password: 'Legacy!User77' },
    });
    assert.equal(legacyLogin.status, 200);
    const upgradedUser = mockPrisma.__store.users.find((u) => u.id === legacyUser.id);
    assert.match(upgradedUser.passwordHash, /^\$argon2id\$/, 'Bcrypt hash must upgrade transparently to Argon2id');

    // K. Logout invalidates refresh token
    const logoutRes = await requestJson(baseUrl, '/api/auth/logout', {
      method: 'POST',
      cookies: legacyLogin.cookies,
      headers: { 'X-CSRF-Token': legacyLogin.cookies.crm_csrf },
    });
    assert.equal(logoutRes.status, 200);
    const afterLogoutRefresh = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      cookies: legacyLogin.cookies,
      headers: { 'X-CSRF-Token': legacyLogin.cookies.crm_csrf },
    });
    assert.equal(afterLogoutRefresh.status, 401);

    // L. Multi-tenant Admin isolation & smtpPassword scrubbing
    const admin1Hash = await passwordService.hashPassword('AdminOne!Pass9');
    const admin2Hash = await passwordService.hashPassword('AdminTwo!Pass9');
    const admin1 = await mockPrisma.user.create({
      data: {
        username: 'admin1@example.com',
        email: 'admin1@example.com',
        passwordHash: admin1Hash,
        name: 'Admin One',
        role: 'admin',
        smtpGmail: 'a1@gmail.com',
        smtpPassword: passwordService.encryptSecret('super-secret-app-pass'),
      },
    });
    const admin2 = await mockPrisma.user.create({
      data: {
        username: 'admin2@example.com',
        email: 'admin2@example.com',
        passwordHash: admin2Hash,
        name: 'Admin Two',
        role: 'admin',
      },
    });
    const admin1Login = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': nextIp() },
      body: { email: 'admin1@example.com', password: 'AdminOne!Pass9' },
    });
    const usersList = await requestJson(baseUrl, '/api/users', { cookies: admin1Login.cookies });
    assert.equal(usersList.status, 200);
    assert.equal(usersList.data.length, 1);
    assert.equal(usersList.data[0].smtpPassword, undefined, 'smtpPassword must never be exposed in API responses');
    assert.equal(usersList.data[0].passwordHash, undefined);
    assert.equal(usersList.data[0].hasSmtpPassword, true);

    // Admin 1 cannot modify Admin 2 (cross-tenant IDOR blocked)
    const idorAttempt = await requestJson(baseUrl, `/api/users/${admin2.id}`, {
      method: 'PUT',
      cookies: admin1Login.cookies,
      headers: { 'X-CSRF-Token': admin1Login.cookies.crm_csrf },
      body: { name: 'Hacked Admin2' },
    });
    assert.equal(idorAttempt.status, 403);

    // M. Brute-force lockout & rate limiting work
    const attackerIp = nextIp();
    let gotRateLimited = false;
    for (let i = 0; i < 18; i++) {
      const attempt = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': attackerIp },
        body: { email: 'alice@example.com', password: 'Wrong!Password99' },
      });
      if (attempt.status === 429) {
        gotRateLimited = true;
        break;
      }
    }
    assert.equal(gotRateLimited, true, 'Login endpoint must enforce brute-force lockout / rate limiting');

    // N. Cloudflare Turnstile enforcement, siteverify validation, CF-Connecting-IP, and security headers
    const prevSecret = process.env.TURNSTILE_SECRET_KEY;
    const prevAxiosPost = axios.post;
    try {
      process.env.TURNSTILE_SECRET_KEY = 'live-test-turnstile-secret-key';

      const missingTurnstile = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.42' },
        body: { email: 'legacy@example.com', password: 'Legacy!User77' },
      });
      assert.equal(missingTurnstile.status, 400);

      const mobileNoTurnstile = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.42', 'X-Client-Platform': 'mobile' },
        body: { email: 'legacy@example.com', password: 'Legacy!User77', clientType: 'mobile' },
      });
      assert.equal(mobileNoTurnstile.status, 200, 'Native mobile clients should be exempted from Turnstile');
      assert.ok(mobileNoTurnstile.data.accessToken);

      axios.post = async (url, payload) => {
        if (url.includes('challenges.cloudflare.com/turnstile/v0/siteverify')) {
          const params = new URLSearchParams(payload);
          const token = params.get('response');
          assert.equal(params.get('remoteip'), '198.51.100.42');
          return {
            data: token === 'valid-cf-token'
              ? { success: true, action: 'login', hostname: 'localhost' }
              : { success: false, 'error-codes': ['invalid-input-response'] },
          };
        }
        return prevAxiosPost(url, payload);
      };

      const badTurnstile = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.42' },
        body: { email: 'legacy@example.com', password: 'Legacy!User77', turnstileToken: 'forged-token' },
      });
      assert.equal(badTurnstile.status, 403);

      const goodTurnstile = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.42', 'X-Client-Platform': 'mobile' },
        body: { email: 'legacy@example.com', password: 'Legacy!User77', turnstileToken: 'valid-cf-token', clientType: 'mobile' },
      });
      assert.equal(goodTurnstile.status, 200);
      assert.ok(goodTurnstile.data.refreshToken, 'Mobile clients must receive refreshToken in JSON');
      assert.equal(goodTurnstile.cookies.crm_access_token, undefined, 'Mobile clients should not receive browser auth cookies');
      assert.match(goodTurnstile.headers.get('content-security-policy') || '', /challenges\.cloudflare\.com/);

      // Spaced and mixed-case legacy usernames (e.g. "Pooja Negi" / "pooja negi") must authenticate case-insensitively
      const spacedHash = await passwordService.hashPassword('Pooja@123');
      mockPrisma.__store.users.push({
        id: 'spaced-user-1',
        username: 'Pooja Negi',
        email: null,
        passwordHash: spacedHash,
        name: 'Pooja Negi',
        role: 'agent',
        tlId: null,
        adminId: null,
        receiverMail: null,
        active: true,
        isDeleted: false,
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const spacedLogin = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.42' },
        body: { identifier: 'pooja negi', password: 'Pooja@123', turnstileToken: 'valid-cf-token' },
      });
      assert.equal(spacedLogin.status, 200);
      assert.equal(spacedLogin.data.user.username, 'Pooja Negi');

      const mobileRefresh = await requestJson(baseUrl, '/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Client-Platform': 'mobile' },
        body: { refreshToken: goodTurnstile.data.refreshToken, clientType: 'mobile' },
      });
      assert.equal(mobileRefresh.status, 200);
      assert.ok(mobileRefresh.data.accessToken);
      assert.ok(mobileRefresh.data.refreshToken);
      assert.notEqual(mobileRefresh.data.refreshToken, goodTurnstile.data.refreshToken);

      const frameRes = await fetch(`${baseUrl}/api/auth/turnstile-frame?action=login`);
      assert.equal(frameRes.status, 200);
      const frameHtml = await frameRes.text();
      assert.match(frameHtml, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
      assert.match(frameHtml, /ReactNativeWebView\.postMessage/);
    } finally {
      axios.post = prevAxiosPost;
      if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = prevSecret;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
