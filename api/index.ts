import app from '../server.js';

export const config = {
  maxDuration: 60,
};

/**
 * Vercel Serverless Function entrypoint that forwards all /api/* requests
 * to the Express application defined in server.ts.
 */
export default function handler(req: any, res: any) {
  if (typeof req.url === 'string') {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = parsedUrl.pathname;

    // Reconstruct the full /api/... path if Vercel's rewrite passed the sub-route via ?path=
    const rewritePath = parsedUrl.searchParams.get('path') ?? req.query?.path;
    if (
      (pathname === '/api' || pathname === '/api/' || pathname === '/api/index') &&
      rewritePath
    ) {
      const joined = Array.isArray(rewritePath) ? rewritePath.join('/') : String(rewritePath);
      pathname = `/api/${joined.replace(/^\/+/, '')}`;
      parsedUrl.searchParams.delete('path');
    } else if (!pathname.startsWith('/api')) {
      pathname = `/api${pathname.startsWith('/') ? '' : '/'}${pathname}`;
    }

    const search = parsedUrl.searchParams.toString();
    req.url = search ? `${pathname}?${search}` : pathname;
    req.originalUrl = req.url;
  }

  return app(req, res);
}
