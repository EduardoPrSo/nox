import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type IdentityContext = {
  userId: string;
  deviceId: string;
  sessionId: string;
};

export type AuthenticationResult =
  | { authenticated: true; identity: IdentityContext }
  | { authenticated: false; reason: 'UNAUTHORIZED' | 'INVALID_SESSION' };

const sessionIdSchema = z.string().uuid();

export class StaticTokenAuthenticator {
  private readonly tokenDigest: Buffer;

  constructor(
    token: string,
    private readonly identity: Omit<IdentityContext, 'sessionId'>,
  ) {
    this.tokenDigest = digest(token);
  }

  authenticate(authorization: string | undefined, sessionId?: string): AuthenticationResult {
    const token = bearerToken(authorization);
    if (!token || !timingSafeEqual(this.tokenDigest, digest(token))) {
      return { authenticated: false, reason: 'UNAUTHORIZED' };
    }
    if (sessionId && !sessionIdSchema.safeParse(sessionId).success) {
      return { authenticated: false, reason: 'INVALID_SESSION' };
    }
    return {
      authenticated: true,
      identity: { ...this.identity, sessionId: sessionId ?? randomUUID() },
    };
  }
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length).trim();
  return token || undefined;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
