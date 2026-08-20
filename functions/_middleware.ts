import {
  authenticateRequest,
  isAuthenticatedUser,
  isSameOrigin,
  isUnsafeMethod,
} from './lib/auth';

function requiresIdentity(pathname: string): boolean {
  return pathname === '/albums'
    || pathname.startsWith('/albums/')
    || pathname.startsWith('/api/');
}

function addSecurityHeaders(response: Response, isPrivate: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );

  if (isPrivate) {
    headers.set('Cache-Control', 'private, no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const pathname = new URL(request.url).pathname;
  const privateRoute = requiresIdentity(pathname);

  if (!privateRoute) {
    return addSecurityHeaders(await context.next(), false);
  }

  if (pathname.startsWith('/api/') && isUnsafeMethod(request.method) && !isSameOrigin(request)) {
    return addSecurityHeaders(Response.json({ error: 'Cross-site requests are not allowed' }, { status: 403 }), true);
  }

  const identity = await authenticateRequest(request, env);
  if (!isAuthenticatedUser(identity)) {
    return addSecurityHeaders(identity, true);
  }

  context.data.user = identity;
  return addSecurityHeaders(await context.next(), true);
};
