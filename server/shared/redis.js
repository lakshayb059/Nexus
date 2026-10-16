const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

let redisClient = null;
let pubClient = null;
let subClient = null;
let isConnected = false;

// Fallback in-memory cache if Redis is not configured or temporarily unavailable
const inMemoryCache = new Map();

function initRedis() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn('⚠️ [REDIS] No REDIS_URL provided. Operating in in-memory fallback mode.');
    return;
  }

  try {
    const isTls = redisUrl.startsWith('rediss://');
    const clientOptions = {
      url: redisUrl,
      socket: isTls ? { tls: true, rejectUnauthorized: false } : {}
    };

    redisClient = createClient(clientOptions);

    redisClient.on('error', (err) => {
      console.warn('⚠️ [REDIS Client Error]:', err.message);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('🔌 [REDIS] Connected successfully to Redis server');
      isConnected = true;
    });

    redisClient.connect().catch((err) => {
      console.warn('⚠️ [REDIS Connection Failure]: Running in in-memory fallback mode.', err.message);
      isConnected = false;
    });
  } catch (err) {
    console.error('❌ [REDIS Initialization Error]:', err.message);
    isConnected = false;
  }
}

async function initRedisSocketAdapter(io) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('ℹ️ [Socket.io] Using standard in-memory adapter (Single instance mode)');
    return;
  }

  try {
    const isTls = redisUrl.startsWith('rediss://');
    const clientOptions = {
      url: redisUrl,
      socket: isTls ? { tls: true, rejectUnauthorized: false } : {}
    };

    pubClient = createClient(clientOptions);
    subClient = pubClient.duplicate();

    pubClient.on('error', (err) => console.warn('⚠️ [Redis PubClient Error]:', err.message));
    subClient.on('error', (err) => console.warn('⚠️ [Redis SubClient Error]:', err.message));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ [Socket.io] Redis cluster adapter attached successfully for real-time scale');
  } catch (err) {
    console.warn('⚠️ [Socket.io Redis Adapter Failed]: Falling back to in-memory adapter.', err.message);
  }
}

async function getCache(key) {
  if (isConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) return JSON.parse(data);
      return null;
    } catch (err) {
      console.warn(`⚠️ [REDIS getCache Error for ${key}]:`, err.message);
    }
  }

  // Fallback to in-memory map
  const item = inMemoryCache.get(key);
  if (item && Date.now() < item.expiry) {
    return item.data;
  }
  return null;
}

async function setCache(key, value, ttlSeconds = 60) {
  if (isConnected && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn(`⚠️ [REDIS setCache Error for ${key}]:`, err.message);
    }
  }

  // Fallback to in-memory map
  inMemoryCache.set(key, {
    data: value,
    expiry: Date.now() + (ttlSeconds * 1000)
  });
}

async function delCache(patternOrKey) {
  if (isConnected && redisClient) {
    try {
      if (patternOrKey.includes('*')) {
        const keys = await redisClient.keys(patternOrKey);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      } else {
        await redisClient.del(patternOrKey);
      }
      return;
    } catch (err) {
      console.warn(`⚠️ [REDIS delCache Error for ${patternOrKey}]:`, err.message);
    }
  }

  // Fallback in-memory purge
  if (patternOrKey.includes('*')) {
    const prefix = patternOrKey.replace('*', '');
    for (const key of inMemoryCache.keys()) {
      if (key.startsWith(prefix)) inMemoryCache.delete(key);
    }
  } else {
    inMemoryCache.delete(patternOrKey);
  }
}

function isRedisConnected() {
  return isConnected;
}

// Auto-initialize on module import
initRedis();

module.exports = {
  redisClient,
  initRedisSocketAdapter,
  getCache,
  setCache,
  delCache,
  isRedisConnected
};
