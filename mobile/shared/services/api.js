import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'nexus_access_token',
  REFRESH_TOKEN: 'nexus_refresh_token',
  USER: 'nexus_user',
  SERVER_URL: 'nexus_server_url',
};

export function getDynamicLocalServerUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    '';
  const metroHost = hostUri ? hostUri.split(':')[0] : '';
  if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1') {
    return `http://${metroHost}:4000`;
  }
  return Constants.expoConfig?.extra?.localServerUrl || 'http://10.226.235.50:4000';
}

const DEFAULT_SERVER_URL =
  (typeof __DEV__ !== 'undefined' && __DEV__)
    ? getDynamicLocalServerUrl()
    : (Constants.expoConfig?.extra?.serverUrl || 'https://nexus-2xsa.onrender.com');

let inMemoryAccessToken = null;
let inMemoryRefreshToken = null;
let currentServerUrl = DEFAULT_SERVER_URL.replace(/\/$/, '');
let unauthorizedHandler = null;
let refreshPromise = null;

export function getServerUrl() {
  return currentServerUrl;
}

export function getApiBaseUrl() {
  return `${currentServerUrl}/api`;
}

export function getAccessToken() {
  return inMemoryAccessToken;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export async function setServerUrl(url) {
  const cleaned = String(url || DEFAULT_SERVER_URL).trim().replace(/\/$/, '');
  currentServerUrl = cleaned;
  api.defaults.baseURL = `${cleaned}/api`;
  await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, cleaned);
  return cleaned;
}

export async function loadStoredSession() {
  const [savedUrl, access, refresh, rawUser] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
    SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
    SecureStore.getItemAsync(STORAGE_KEYS.USER),
  ]);

  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (isDev) {
    currentServerUrl = DEFAULT_SERVER_URL.replace(/\/$/, '');
    api.defaults.baseURL = `${currentServerUrl}/api`;
  } else if (savedUrl) {
    currentServerUrl = savedUrl.replace(/\/$/, '');
    api.defaults.baseURL = `${currentServerUrl}/api`;
  }

  inMemoryAccessToken = access || null;
  inMemoryRefreshToken = refresh || null;

  let user = null;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      user = null;
    }
  }

  return {
    serverUrl: currentServerUrl,
    accessToken: inMemoryAccessToken,
    refreshToken: inMemoryRefreshToken,
    user,
  };
}

export async function saveAuthSession({ accessToken, refreshToken, user }) {
  if (accessToken !== undefined) {
    inMemoryAccessToken = accessToken || null;
    if (accessToken) {
      await SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
    }
  }

  if (refreshToken !== undefined) {
    inMemoryRefreshToken = refreshToken || null;
    if (refreshToken) {
      await SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
    }
  }

  if (user !== undefined) {
    if (user) {
      await SecureStore.setItemAsync(STORAGE_KEYS.USER, JSON.stringify(user));
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER);
    }
  }
}

export async function clearAuthSession() {
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(STORAGE_KEYS.USER),
  ]);
}

export function getRefreshToken() {
  return inMemoryRefreshToken;
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 20000,
});

const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/cloudflare-config',
];

function isPublicAuthRequest(url = '') {
  return PUBLIC_AUTH_PATHS.some((path) => url.includes(path));
}

api.interceptors.request.use(
  (config) => {
    config.baseURL = getApiBaseUrl();
    config.headers['X-Client-Platform'] = 'mobile';
    if (inMemoryAccessToken) {
      config.headers['Authorization'] = `Bearer ${inMemoryAccessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export async function rotateMobileTokens() {
  if (!inMemoryRefreshToken) {
    throw new Error('No refresh token available');
  }

  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${getApiBaseUrl()}/auth/refresh`,
        { refreshToken: inMemoryRefreshToken, clientType: 'mobile' },
        { headers: { 'X-Client-Platform': 'mobile' }, timeout: 15000 }
      )
      .then(async (res) => {
        const { accessToken, refreshToken, user } = res.data || {};
        await saveAuthSession({ accessToken, refreshToken, user });
        return res.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    if (response && response.status === 502 && config) {
      config.__retryCount = config.__retryCount || 0;
      if (config.__retryCount < 3) {
        config.__retryCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 3500));
        return api(config);
      }
    }

    if (
      response &&
      response.status === 401 &&
      config &&
      !config.__isRetryAfterRefresh &&
      !isPublicAuthRequest(config.url)
    ) {
      config.__isRetryAfterRefresh = true;
      try {
        await rotateMobileTokens();
        if (inMemoryAccessToken) {
          config.headers['Authorization'] = `Bearer ${inMemoryAccessToken}`;
        }
        return api(config);
      } catch {
        await clearAuthSession();
        if (unauthorizedHandler) {
          unauthorizedHandler();
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
