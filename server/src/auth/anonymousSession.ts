import crypto from 'crypto';

import type { RequestHandler } from 'express';

import { nanoid } from 'nanoid';

interface AnonymousSessionPayload {
  sid: string;
  iat: number;
  exp: number;
  v: 1;
}

interface AnonymousSessionIssueResult {
  token: string;
  expiresAt: string;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_VERSION = 1;
const AUTHORIZATION_PREFIX = 'Bearer ';
const SESSION_SECRET = getSessionSecret();

function parsePositiveInteger(rawValue: string | undefined, fallbackValue: number): number {
  const parsedValue = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }

  return parsedValue;
}

function getSessionSecret(): string {
  const configuredSecret = process.env.ANON_SESSION_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ANON_SESSION_SECRET must be set in production.');
  }

  return 'dev-only-anon-session-secret-change-me';
}

function getSessionTtlSeconds(): number {
  return parsePositiveInteger(process.env.ANON_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
}

function signTokenPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function encodePayload(payload: AnonymousSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(encodedPayload: string): AnonymousSessionPayload | null {
  try {
    const jsonPayload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsedPayload = JSON.parse(jsonPayload) as Partial<AnonymousSessionPayload>;
    if (
      typeof parsedPayload.sid !== 'string' ||
      !parsedPayload.sid ||
      typeof parsedPayload.iat !== 'number' ||
      !Number.isFinite(parsedPayload.iat) ||
      typeof parsedPayload.exp !== 'number' ||
      !Number.isFinite(parsedPayload.exp) ||
      parsedPayload.v !== TOKEN_VERSION
    ) {
      return null;
    }

    return {
      sid: parsedPayload.sid,
      iat: parsedPayload.iat,
      exp: parsedPayload.exp,
      v: TOKEN_VERSION,
    };
  } catch {
    return null;
  }
}

function hasValidSignature(encodedPayload: string, receivedSignature: string): boolean {
  const expectedSignature = signTokenPayload(encodedPayload);
  const receivedSignatureBuffer = Buffer.from(receivedSignature, 'utf8');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

  if (receivedSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedSignatureBuffer, expectedSignatureBuffer);
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  if (!authorizationHeader.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(AUTHORIZATION_PREFIX.length).trim();
  return token || null;
}

export function issueAnonymousSession(): AnonymousSessionIssueResult {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + getSessionTtlSeconds();
  const payload: AnonymousSessionPayload = {
    sid: nanoid(16),
    iat: issuedAt,
    exp: expiresAt,
    v: TOKEN_VERSION,
  };

  const encodedPayload = encodePayload(payload);
  const signature = signTokenPayload(encodedPayload);
  const token = `${encodedPayload}.${signature}`;

  return {
    token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

function verifyAnonymousToken(token: string): AnonymousSessionPayload | null {
  const tokenParts = token.split('.');
  if (tokenParts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = tokenParts;
  if (!encodedPayload || !signature) {
    return null;
  }

  if (!hasValidSignature(encodedPayload, signature)) {
    return null;
  }

  const payload = decodePayload(encodedPayload);
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return payload;
}

export const requireAnonymousSessionForWrites: RequestHandler = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    res.status(401).json({ error: 'Missing anonymous session token' });
    return;
  }

  const payload = verifyAnonymousToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired anonymous session token' });
    return;
  }

  next();
};
