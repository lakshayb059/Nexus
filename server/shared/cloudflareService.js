const axios = require('axios');

const CLOUDFLARE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CLOUDFLARE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
const CLOUDFLARE_TEST_SITE_KEY = '1x00000000000000000000AA';

function getTurnstileConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  const configuredSecret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  const configuredSiteKey = (process.env.TURNSTILE_SITE_KEY || '').trim();

  if (configuredSecret) {
    return {
      enabled: true,
      mode: 'live',
      secretKey: configuredSecret,
      siteKey: configuredSiteKey || null,
    };
  }

  // In non-production local dev, use Cloudflare's official test keys so Turnstile verification runs end-to-end
  if (!isProd && !isTest) {
    return {
      enabled: true,
      mode: 'test',
      secretKey: CLOUDFLARE_TEST_SECRET_KEY,
      siteKey: configuredSiteKey || CLOUDFLARE_TEST_SITE_KEY,
    };
  }

  // In automated unit tests without TURNSTILE_SECRET_KEY, allow explicit opt-in via env
  return {
    enabled: Boolean(isProd && process.env.TURNSTILE_REQUIRED !== 'false'),
    mode: isProd ? 'live' : 'disabled',
    secretKey: configuredSecret || null,
    siteKey: configuredSiteKey || null,
  };
}

function getCloudflareClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || undefined;
}

/**
 * Verifies a Cloudflare Turnstile response token via Cloudflare's siteverify API.
 */
async function verifyTurnstileToken({ token, remoteIp, expectedAction }) {
  const config = getTurnstileConfig();

  if (!config.enabled) {
    return { success: true, skipped: true };
  }

  if (!config.secretKey) {
    return {
      success: false,
      status: 503,
      error: 'Cloudflare Turnstile protection is not configured on the server.',
    };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      status: 400,
      error: 'Please complete the Cloudflare security verification.',
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', config.secretKey);
    formData.append('response', token.trim());
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const response = await axios.post(CLOUDFLARE_SITEVERIFY_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 6000,
    });

    const data = response.data || {};
    if (!data.success) {
      return {
        success: false,
        status: 403,
        error: 'Cloudflare security verification failed. Please try again.',
        errorCodes: data['error-codes'] || [],
      };
    }

    if (expectedAction && data.action && data.action !== expectedAction) {
      return {
        success: false,
        status: 403,
        error: 'Security verification action mismatch. Please refresh and try again.',
      };
    }

    const allowedHostnames = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (allowedHostnames.length > 0 && data.hostname && !allowedHostnames.includes(data.hostname.toLowerCase())) {
      return {
        success: false,
        status: 403,
        error: 'Security verification hostname mismatch.',
      };
    }

    return {
      success: true,
      hostname: data.hostname || null,
      action: data.action || null,
    };
  } catch (err) {
    console.error('⚠️ [CLOUDFLARE TURNSTILE ERROR]:', err.message);
    return {
      success: false,
      status: 503,
      error: 'Unable to reach Cloudflare security verification service. Please retry.',
    };
  }
}

/**
 * Express middleware enforcing Cloudflare Turnstile verification on protected public auth endpoints.
 * Native mobile clients (identified via X-Client-Platform: mobile or clientType: 'mobile') are exempted
 * when no Turnstile token is sent, while web requests always require Turnstile verification.
 */
function requireTurnstile(expectedAction = null) {
  return async (req, res, next) => {
    const token = req.body?.turnstileToken || req.body?.['cf-turnstile-response'];
    const isMobileClient =
      req.headers?.['x-client-platform'] === 'mobile' ||
      req.body?.clientType === 'mobile';

    if (isMobileClient && (!token || typeof token !== 'string' || !token.trim())) {
      req.cloudflare = {
        turnstileVerified: false,
        mobileExempt: true,
        cfRay: req.headers['cf-ray'] || null,
        cfCountry: req.headers['cf-ipcountry'] || null,
      };
      return next();
    }

    const result = await verifyTurnstileToken({
      token,
      remoteIp: getCloudflareClientIp(req),
      expectedAction,
    });

    if (!result.success) {
      return res.status(result.status || 403).json({ error: result.error });
    }

    req.cloudflare = {
      turnstileVerified: !result.skipped,
      cfRay: req.headers['cf-ray'] || null,
      cfCountry: req.headers['cf-ipcountry'] || null,
    };
    return next();
  };
}

/**
 * Global Cloudflare-compatible security header middleware for the CRM application.
 */
function cloudflareSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.path === '/api/auth/turnstile-frame' || req.path === '/auth/turnstile-frame') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline';"
    );
    return next();
  }

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com ws: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none';"
  );
  next();
}

module.exports = {
  CLOUDFLARE_TEST_SITE_KEY,
  CLOUDFLARE_TEST_SECRET_KEY,
  getTurnstileConfig,
  getCloudflareClientIp,
  verifyTurnstileToken,
  requireTurnstile,
  cloudflareSecurityHeaders,
};
