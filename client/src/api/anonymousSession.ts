const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';
const SESSION_STORAGE_KEY = 'pong:anonymousSession';
const SESSION_REFRESH_LEEWAY_MS = 60 * 1000;

interface StoredAnonymousSession {
  token: string;
  expiresAt: string;
}

interface AnonymousSessionResponse {
  token?: string;
  expiresAt?: string;
  error?: string;
  message?: string;
}

function getApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  const normalizedBaseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBaseUrl}${path}`;
}

function readStoredAnonymousSession(): StoredAnonymousSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!rawSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(rawSession) as StoredAnonymousSession;
    if (typeof parsedSession.token !== 'string' || typeof parsedSession.expiresAt !== 'string') {
      return null;
    }

    return parsedSession;
  } catch (error) {
    console.error('Failed to parse anonymous session from storage:', error);
    return null;
  }
}

function persistAnonymousSession(session: StoredAnonymousSession): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function isSessionStillValid(session: StoredAnonymousSession): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return (expiresAt - Date.now()) > SESSION_REFRESH_LEEWAY_MS;
}

async function getApiErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as AnonymousSessionResponse;
    const errorMessage = typeof payload.error === 'string' ? payload.error.trim() : '';
    if (errorMessage) return errorMessage;
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (message) return message;
  } catch (error) {
    console.error('Failed to parse session API error response:', error);
  }

  return fallbackMessage;
}

async function requestAnonymousSession(): Promise<StoredAnonymousSession> {
  const response = await fetch(getApiUrl('/api/session/anonymous'), {
    method: 'POST',
  });

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(errorMessage);
  }

  const payload = (await response.json()) as AnonymousSessionResponse;
  if (typeof payload.token !== 'string' || typeof payload.expiresAt !== 'string') {
    throw new Error('Invalid session response payload.');
  }

  const session: StoredAnonymousSession = {
    token: payload.token,
    expiresAt: payload.expiresAt,
  };

  persistAnonymousSession(session);
  return session;
}

export function clearAnonymousSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function getAnonymousSessionToken(options?: { forceRefresh?: boolean }): Promise<string> {
  if (!options?.forceRefresh) {
    const storedSession = readStoredAnonymousSession();
    if (storedSession && isSessionStillValid(storedSession)) {
      return storedSession.token;
    }
  }

  const newSession = await requestAnonymousSession();
  return newSession.token;
}
