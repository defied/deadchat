import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Refresh the access token, safely across tabs.
 *
 * Refresh tokens are single-use (the server rotates them). Every open tab
 * shares localStorage, so without coordination two tabs whose access token
 * expired at the same moment both spend the same refresh token: one wins and
 * the other gets a 401 and logs *every* tab out. A Web Lock serialises tabs,
 * and a tab that finds the token already rotated simply adopts the new one.
 *
 * `staleAccess` is the access token the failed request was sent with.
 */
let inflight: Promise<string> | null = null;

async function doRefresh(staleAccess: string | null): Promise<string> {
  const run = async (): Promise<string> => {
    const current = localStorage.getItem('accessToken');
    if (current && current !== staleAccess) return current; // another tab already refreshed

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    try {
      const { data } = await axios.post(`${import.meta.env.VITE_API_URL || ''}/api/auth/refresh`, { refreshToken });
      localStorage.setItem('accessToken', data.accessToken);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      return data.accessToken as string;
    } catch (err) {
      // Lost a race with a tab that doesn't support locks: use its fresh token.
      const now = localStorage.getItem('accessToken');
      if (localStorage.getItem('refreshToken') !== refreshToken && now) return now;
      throw err;
    }
  };
  const locks = (navigator as Navigator & { locks?: { request: (n: string, cb: () => Promise<string>) => Promise<string> } }).locks;
  return locks ? locks.request('deadchat-token-refresh', run) : run();
}

/** Shared within a tab so concurrent 401s trigger a single refresh. */
export function refreshAccessToken(staleAccess: string | null): Promise<string> {
  if (!inflight) {
    inflight = doRefresh(staleAccess).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // A 401 from login/refresh means bad credentials, not an expired session —
    // let the caller show the error instead of bouncing to /login.
    const url: string = originalRequest?.url || '';
    const isAuthCall = url.includes('/api/auth/login') || url.includes('/api/auth/refresh');

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthCall) {
      originalRequest._retry = true;
      const sentWith = String(originalRequest.headers?.Authorization || '').replace(/^Bearer\s+/i, '') || null;
      try {
        const token = await refreshAccessToken(sentWith);
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return client(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default client;
