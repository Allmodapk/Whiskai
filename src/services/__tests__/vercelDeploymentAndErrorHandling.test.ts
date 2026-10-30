import assert from 'node:assert/strict';
import { extractApiErrorMessage } from '../apiClient';

// Prevent server.ts from opening a live TCP port when imported in unit tests
process.env.VERCEL = '1';

async function runTests() {
  const { default: vercelHandler } = await import('../../../api/index');
  const { formatServerErrorMessage } = await import('../../../server');

  // 1. Verify extractApiErrorMessage handles object-shaped errors and never returns "[object Object]"
  const vercel404Payload = {
    error: {
      code: 'NOT_FOUND',
      message: 'The page could not be found',
    },
  };
  const msg404 = extractApiErrorMessage(vercel404Payload, 'Fallback error', 404);
  assert.ok(!msg404.includes('[object Object]'), 'Should never return [object Object]');
  assert.ok(msg404.includes('404'), 'Should mention 404 backend endpoint');

  // Verify Error constructed from an object (which sets err.message = "[object Object]")
  const coercedObjError = new Error(({ code: 'ERR_OBJ' } as unknown) as string);
  assert.equal(coercedObjError.message, '[object Object]');
  const recoveredMsg = extractApiErrorMessage(coercedObjError, 'Clean fallback message');
  assert.equal(recoveredMsg, 'Clean fallback message');

  // Verify nested Google GenAI / API error object
  const nestedApiError = {
    error: {
      code: 400,
      message: 'Invalid image payload provided to model.',
      status: 'INVALID_ARGUMENT',
    },
  };
  assert.equal(
    extractApiErrorMessage(nestedApiError, 'Fallback'),
    'Invalid image payload provided to model.'
  );

  // Verify JSON-serialized error message inside Error.message
  const jsonWrappedError = new Error(
    JSON.stringify({
      error: {
        code: 403,
        message: 'Caller does not have permission for key AIzaSyD1234567890abcdefghijklmnop',
      },
    })
  );
  const redactedClientMsg = extractApiErrorMessage(jsonWrappedError, 'Fallback');
  assert.ok(!redactedClientMsg.includes('AIzaSyD1234567890abcdefghijklmnop'), 'Must redact API key');
  assert.ok(redactedClientMsg.includes('[REDACTED_API_KEY]'), 'Should replace secret with placeholder');

  const redactedServerMsg = formatServerErrorMessage(jsonWrappedError, 'Fallback');
  assert.ok(!redactedServerMsg.includes('AIzaSyD1234567890abcdefghijklmnop'), 'Server must redact API key');
  assert.ok(!redactedServerMsg.includes('[object Object]'));

  // Helper to invoke the Vercel serverless handler in-memory with a mock req/res pair
  function invokeVercelHandler(options: {
    method: string;
    url: string;
    query?: Record<string, any>;
    headers?: Record<string, string>;
    body?: any;
  }): Promise<{ statusCode: number; body: any }> {
    return new Promise((resolve) => {
      const req: any = {
        method: options.method,
        url: options.url,
        originalUrl: options.url,
        query: options.query || {},
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body,
        on: () => req,
        once: () => req,
        emit: () => false,
      };

      const headersMap: Record<string, string> = {};
      const res: any = {
        statusCode: 200,
        setHeader(k: string, v: string) {
          headersMap[k.toLowerCase()] = v;
          return res;
        },
        getHeader(k: string) {
          return headersMap[k.toLowerCase()];
        },
        header(k: string, v: string) {
          headersMap[k.toLowerCase()] = v;
          return res;
        },
        status(code: number) {
          res.statusCode = code;
          return res;
        },
        json(payload: any) {
          resolve({ statusCode: res.statusCode, body: payload });
          return res;
        },
        send(payload: any) {
          try {
            resolve({
              statusCode: res.statusCode,
              body: typeof payload === 'string' ? JSON.parse(payload) : payload,
            });
          } catch {
            resolve({ statusCode: res.statusCode, body: payload });
          }
          return res;
        },
        end(payload?: any) {
          resolve({ statusCode: res.statusCode, body: payload });
          return res;
        },
      };

      vercelHandler(req, res);
    });
  }

  // 2. Verify GET /api/health via direct URL, Vercel rewrite (?path=health), and stripped URL (/health)
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test_server_gemini_key';

  const healthDirect = await invokeVercelHandler({ method: 'GET', url: '/api/health' });
  assert.equal(healthDirect.statusCode, 200);
  assert.equal(healthDirect.body.status, 'ok');
  assert.equal(healthDirect.body.hasServerKey, true);

  const healthRewritten = await invokeVercelHandler({
    method: 'GET',
    url: '/api?path=health',
    query: { path: 'health' },
  });
  assert.equal(healthRewritten.statusCode, 200);
  assert.equal(healthRewritten.body.status, 'ok');

  const healthStripped = await invokeVercelHandler({ method: 'GET', url: '/health' });
  assert.equal(healthStripped.statusCode, 200);
  assert.equal(healthStripped.body.status, 'ok');

  // 3. Verify POST /api/analyze-reference routes cleanly through Vercel handler with pre-parsed body
  const analyzeEmpty = await invokeVercelHandler({
    method: 'POST',
    url: '/api?path=analyze-reference',
    query: { path: 'analyze-reference' },
    body: { images: [] },
  });
  assert.equal(analyzeEmpty.statusCode, 400);
  assert.equal(typeof analyzeEmpty.body.error, 'string');
  assert.ok(analyzeEmpty.body.error.includes('At least one reference image is required'));

  // 4. Verify missing GEMINI_API_KEY returns a clear string error (never [object Object])
  delete process.env.GEMINI_API_KEY;
  const analyzeMissingKey = await invokeVercelHandler({
    method: 'POST',
    url: '/api/analyze-reference',
    body: { images: [{ data: 'aGVsbG8=', mimeType: 'image/jpeg' }] },
  });
  assert.equal(analyzeMissingKey.statusCode, 401);
  assert.equal(typeof analyzeMissingKey.body.error, 'string');
  assert.ok(!analyzeMissingKey.body.error.includes('[object Object]'));
  assert.ok(analyzeMissingKey.body.error.includes('GEMINI_API_KEY'));

  if (prevKey !== undefined) {
    process.env.GEMINI_API_KEY = prevKey;
  }

  console.log('✓ vercelDeploymentAndErrorHandling.test.ts passed');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
