export interface ApiRequestOptions {
  customKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Redacts any accidental Google API key patterns from error strings so secrets
 * are never displayed or logged.
 */
function redactSecrets(text: string): string {
  return text.replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]');
}

/**
 * Safely converts any unknown error value (Error instance, Vercel error object,
 * Google API error payload, JSON-encoded error string, or nested object) into a
 * clean, human-readable string. Never returns "[object Object]".
 */
export function extractApiErrorMessage(
  errOrData: unknown,
  fallback = 'Analysis request failed. Please try again.',
  httpStatus?: number
): string {
  const visit = (val: unknown, depth = 0): string | null => {
    if (depth > 5 || val === null || val === undefined) return null;

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === '[object Object]') return null;

      // If the string itself is a serialized JSON error payload, unpack it
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          const nested = visit(parsed, depth + 1);
          if (nested) return nested;
        } catch {
          // Not valid JSON; use the raw string below
        }
      }
      return redactSecrets(trimmed);
    }

    if (val instanceof Error) {
      const fromMsg = visit(val.message, depth + 1);
      if (fromMsg) return fromMsg;
      const anyErr = val as unknown as Record<string, unknown>;
      return (
        visit(anyErr.error, depth + 1) ||
        visit(anyErr.details, depth + 1) ||
        visit(anyErr.statusText, depth + 1) ||
        null
      );
    }

    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;

      // Detect Vercel platform NOT_FOUND / FUNCTION_INVOCATION_FAILED error shapes
      const code =
        typeof obj.code === 'string'
          ? obj.code
          : typeof (obj.error as any)?.code === 'string'
          ? (obj.error as any).code
          : null;

      if (code === 'NOT_FOUND' || httpStatus === 404) {
        const innerMsg =
          visit(obj.message, depth + 1) || visit((obj.error as any)?.message, depth + 1);
        if (
          innerMsg &&
          !innerMsg.toLowerCase().includes('page could not be found') &&
          !innerMsg.toLowerCase().includes('not_found')
        ) {
          return innerMsg;
        }
        return 'Backend API endpoint was not found (404). Please verify that the Vercel /api serverless functions are deployed.';
      }

      // Check standard message fields in priority order
      const candidateFields = [
        obj.message,
        obj.error,
        obj.detail,
        obj.details,
        obj.reason,
        obj.statusText,
      ];
      for (const field of candidateFields) {
        const extracted = visit(field, depth + 1);
        if (extracted) return extracted;
      }

      if (Array.isArray(obj.errors) && obj.errors.length > 0) {
        const first = visit(obj.errors[0], depth + 1);
        if (first) return first;
      }

      if (code) {
        return `Request failed (${redactSecrets(code)}).`;
      }
    }

    return null;
  };

  return visit(errOrData) || fallback;
}

function tryParseJson(rawText: string): { ok: true; value: any } | { ok: false } {
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: false };

  // Reject HTML fallback pages disguised as 200 OK
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html')
  ) {
    return { ok: false };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resilient JSON POST helper for all /api/* endpoints.
 * Automatically retries if the server is mid-restart, returns a non-JSON 200 fallback,
 * or experiences a transient network/503 hiccup.
 */
export async function postApiJson<T = any>(
  endpoint: string,
  payload: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'You appear to be offline. Local blueprints, profiles, and 3D Playboard controls remain available, but live Gemini analysis requires an internet connection.'
    );
  }

  const timeoutMs = options.timeoutMs ?? 45000;
  const maxRetries = options.maxRetries ?? 2;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  };

  if (options.customKey && options.customKey.trim()) {
    headers['x-gemini-key'] = options.customKey.trim();
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url =
        attempt > 0
          ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}_retry=${attempt}_${Date.now()}`
          : endpoint;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      const rawText = await res.text();
      const parsed = tryParseJson(rawText);

      if (!parsed.ok) {
        if (res.status === 404) {
          throw new Error(
            'Backend API endpoint was not found (404). Please verify that the Vercel /api serverless functions are deployed.'
          );
        }
        if (res.status === 413) {
          throw new Error(
            'The uploaded image is too large for the server limit. Please try a smaller image.'
          );
        }
        // If server returned 200 with HTML/empty body (e.g. Vite SPA fallback during server restart or proxy hiccup)
        // or 502/503/504 gateway response, retry automatically
        if (attempt < maxRetries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new Error(
          res.status === 503 || res.status === 504
            ? 'The visual analysis service is temporarily busy. Please try again in a moment.'
            : `The analysis server returned an unexpected non-JSON response (HTTP ${res.status}).`
        );
      }

      const data = parsed.value;

      if (!res.ok) {
        if (
          (res.status === 502 || res.status === 503 || res.status === 504) &&
          attempt < maxRetries
        ) {
          await sleep(900 * (attempt + 1));
          continue;
        }
        if (res.status === 503 || data?.code === 'UNAVAILABLE_ALL_MODELS') {
          throw new Error(
            extractApiErrorMessage(
              data,
              'Gemini is temporarily experiencing high demand. Please try again shortly.',
              res.status
            )
          );
        }
        if (res.status === 429) {
          throw new Error(
            extractApiErrorMessage(
              data,
              'Rate limit or quota reached. Please wait a few moments and retry.',
              res.status
            )
          );
        }
        throw new Error(
          extractApiErrorMessage(
            data,
            `Analysis request failed (Status ${res.status}).`,
            res.status
          )
        );
      }

      return data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        lastError = new Error(
          'Analysis timed out. Please try again with a standard resolution image.'
        );
        if (attempt < maxRetries) {
          await sleep(500);
          continue;
        }
        throw lastError;
      }

      const rawMessage = extractApiErrorMessage(
        err,
        'Network connection to the analysis server was interrupted.'
      );

      // Retry transient network errors
      const isNetworkErr =
        rawMessage.includes('Failed to fetch') ||
        rawMessage.includes('NetworkError') ||
        rawMessage.includes('Load failed') ||
        rawMessage.includes('interrupted');

      if (isNetworkErr && attempt < maxRetries) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      lastError = new Error(
        isNetworkErr
          ? 'Connection to the analysis server was interrupted. Please check your connection and try again.'
          : rawMessage
      );

      throw lastError;
    }
  }

  throw lastError || new Error('Analysis request failed. Please try again.');
}
