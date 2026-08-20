import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface Env {
  // Cloudflare Pagesが実行時に提供するD1/R2バインディング。
  // AstroのDOM型と競合しないよう、ここでは境界型として扱う。
  DB: any;
  R2_BUCKET: any;
  ACCESS_TEAM_DOMAIN?: string;
  // /albums* と /api/* を別のAccessアプリで保護する場合は、カンマ区切りで設定する。
  ACCESS_AUDS?: string;
  // 単一アプリで運用する既存設定との後方互換用。
  ACCESS_AUD?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export interface AuthData extends Record<string, unknown> {
  user?: AuthenticatedUser;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function accessDomain(env: Env): string | null {
  const domain = cleanText(env.ACCESS_TEAM_DOMAIN, 255);
  if (!domain) return null;

  try {
    const url = new URL(domain);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function accessAudiences(env: Env): string[] {
  const raw = env.ACCESS_AUDS ?? env.ACCESS_AUD ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 255);
}

async function verifyAccessToken(request: Request, env: Env): Promise<JWTPayload | Response> {
  const teamDomain = accessDomain(env);
  const audiences = accessAudiences(env);
  if (!teamDomain || audiences.length === 0) {
    return jsonError('Authentication is not configured', 503);
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return jsonError('Authentication is required', 401);
  }

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience: audiences,
    });
    return payload;
  } catch {
    return jsonError('Authentication could not be verified', 403);
  }
}

function isResponse(value: JWTPayload | Response): value is Response {
  return value instanceof Response;
}

export function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<AuthenticatedUser | Response> {
  const payload = await verifyAccessToken(request, env);
  if (isResponse(payload)) return payload;

  const email = cleanText(payload.email, 320)?.toLowerCase();
  const subject = cleanText(payload.sub, 255);
  if (!email || !subject) {
    return jsonError('Authenticated identity is incomplete', 403);
  }

  const name = cleanText(payload.name, 160) ?? email;
  const existing = await env.DB.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ? OR email = ? LIMIT 1',
  ).bind(subject, email).first() as AuthenticatedUser | null;

  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO users (id, email, name) VALUES (?, ?, ?)',
    ).bind(subject, email, name).run();

    return { id: subject, email, name, role: 'member' };
  }

  if (existing.id !== subject) {
    return jsonError('The authenticated account does not match this user record', 403);
  }

  if (existing.name !== name) {
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, subject).run();
  }

  return { ...existing, name };
}

export function apiError(message: string, status: number): Response {
  return jsonError(message, status);
}

export function isAuthenticatedUser(value: AuthenticatedUser | Response): value is AuthenticatedUser {
  return !(value instanceof Response);
}
