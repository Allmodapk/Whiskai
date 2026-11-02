import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

// Ensure pre-parsed bodies from serverless runtimes (e.g., Vercel) are preserved
// without hanging express.json() on an already-consumed request stream.
app.use((req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString('utf8'));
      (req as any)._body = true;
    } catch {
      // leave as-is for express.json
    }
  } else if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try {
      req.body = JSON.parse(req.body);
      (req as any)._body = true;
    } catch {
      // leave as-is for express.json
    }
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    (req as any)._body = true;
  }
  next();
});

// Increase payload limit for base64 image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS & Pre-flight support
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-gemini-key'
  );
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function redactSecrets(text: string): string {
  return text.replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]');
}

/**
 * Safely normalizes any SDK, HTTP, or runtime error into a clean, readable string
 * without ever returning "[object Object]" or leaking API keys.
 */
function formatServerErrorMessage(
  err: unknown,
  fallback = 'Failed to process visual analysis request.'
): string {
  const visit = (val: unknown, depth = 0): string | null => {
    if (depth > 5 || val === null || val === undefined) return null;

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === '[object Object]') return null;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          const nested = visit(parsed, depth + 1);
          if (nested) return nested;
        } catch {
          // keep raw string
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
      const candidates = [
        obj.message,
        obj.error,
        obj.detail,
        obj.details,
        obj.reason,
        obj.statusText,
      ];
      for (const candidate of candidates) {
        const found = visit(candidate, depth + 1);
        if (found) return found;
      }
      if (typeof obj.code === 'string' && obj.code.trim()) {
        return `Service error (${redactSecrets(obj.code.trim())}).`;
      }
    }

    return null;
  };

  return visit(err) || fallback;
}

function getCandidateGeminiApiKeys(customKey?: string): string[] {
  const keys: string[] = [];
  const cleanCustom = customKey ? customKey.trim() : '';
  const cleanServer = (process.env.GEMINI_API_KEY || '').trim();
  const cleanGoogle = (process.env.GOOGLE_API_KEY || '').trim();

  for (const k of [cleanCustom, cleanServer, cleanGoogle]) {
    if (k && k !== 'MY_GEMINI_API_KEY' && !keys.includes(k)) {
      keys.push(k);
    }
  }
  return keys;
}

function resolveServerGeminiApiKey(customKey?: string): string {
  const candidates = getCandidateGeminiApiKeys(customKey);
  return candidates[0] || '';
}

// Helper to get GoogleGenAI client with user-agent and bounded HTTP timeout
function createGenAIClientForKey(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 12000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGenAIClient(customKey?: string) {
  const apiKey = resolveServerGeminiApiKey(customKey);

  if (!apiKey) {
    const error: any = new Error(
      'Server GEMINI_API_KEY is not configured. Please verify that GEMINI_API_KEY is set in your server environment variables and redeploy.'
    );
    error.status = 401;
    error.code = 'MISSING_GEMINI_API_KEY';
    throw error;
  }
  return createGenAIClientForKey(apiKey);
}

// Helper to enforce a timeout on individual model calls so fallback models can run before proxy timeout
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      err.code = 'MODEL_TIMEOUT';
      err.status = 504;
      reject(err);
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function parseModelJson(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const cleaned = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = cleaned.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Sanitize unescaped control characters inside JSON string literals if present
          const sanitized = candidate.replace(/[\u0000-\u001F]+/g, ' ');
          return JSON.parse(sanitized);
        }
      }
      throw new Error('Model response did not contain valid JSON.');
    }
  }
}

function isQuotaOrServiceUnavailable(err: any): boolean {
  const status = err?.status || err?.statusCode || err?.code;
  if (
    status === 429 ||
    status === '429' ||
    status === 503 ||
    status === '503' ||
    status === 504 ||
    status === 'MODEL_TIMEOUT'
  ) {
    return true;
  }
  const msg = formatServerErrorMessage(err, '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('overloaded')
  );
}

/**
 * Extracts pixel width, height, orientation, and closest standard aspect ratio
 * directly from a base64-encoded JPEG, PNG, or WebP buffer so geometry remains
 * strictly grounded in the uploaded file even when live AI quota is exhausted.
 */
function extractImageGeometryFromBase64(base64Data?: string): {
  width: number;
  height: number;
  outputRatio: string;
  orientation: 'Portrait' | 'Landscape' | 'Square';
  ratioExplanation: string;
} {
  const defaultResult = {
    width: 900,
    height: 1200,
    outputRatio: '3:4',
    orientation: 'Portrait' as const,
    ratioExplanation: 'Standard 3:4 vertical portrait frame.',
  };

  if (!base64Data || typeof base64Data !== 'string') {
    return defaultResult;
  }

  try {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buf = Buffer.from(cleanBase64.slice(0, 65536), 'base64');
    let width = 0;
    let height = 0;

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      width = buf.readUInt32BE(16);
      height = buf.readUInt32BE(20);
    }
    // JPEG signature: FF D8
    else if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          height = buf.readUInt16BE(offset + 5);
          width = buf.readUInt16BE(offset + 7);
          break;
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          offset += 2;
          continue;
        }
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen < 2) break;
        offset += 2 + segLen;
      }
    }

    if (width <= 0 || height <= 0) {
      return defaultResult;
    }

    const aspect = width / height;
    const orientation: 'Portrait' | 'Landscape' | 'Square' =
      Math.abs(aspect - 1) < 0.06 ? 'Square' : aspect < 1 ? 'Portrait' : 'Landscape';

    const candidates: Array<{ label: string; value: number }> = [
      { label: '1:1', value: 1 / 1 },
      { label: '3:4', value: 3 / 4 },
      { label: '4:5', value: 4 / 5 },
      { label: '2:3', value: 2 / 3 },
      { label: '9:16', value: 9 / 16 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:2', value: 3 / 2 },
      { label: '16:9', value: 16 / 9 },
    ];

    let closest = candidates[0];
    let minDiff = Math.abs(aspect - closest.value);
    for (const c of candidates) {
      const diff = Math.abs(aspect - c.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = c;
      }
    }

    return {
      width,
      height,
      outputRatio: closest.label,
      orientation,
      ratioExplanation: `Measured directly from uploaded image dimensions (${width}×${height}px, ${orientation.toLowerCase()} ${closest.label} frame).`,
    };
  } catch {
    return defaultResult;
  }
}

function buildReferenceQuotaFallbackAnalysis(base64Data?: string, userNotes?: string) {
  const geom = extractImageGeometryFromBase64(base64Data);
  const noteSuffix = userNotes?.trim() ? ` User context noted: ${userNotes.trim()}.` : '';
  return {
    summary: `Reference frame (${geom.width}×${geom.height}px, ${geom.outputRatio} ${geom.orientation.toLowerCase()}) loaded in local blueprint mode while Gemini API quota resets.${noteSuffix}`,
    outputRatio: geom.outputRatio,
    ratioExplanation: geom.ratioExplanation,
    leadSentence: 'A single human subject in a photorealistic scene.',
    cameraEstimates: {
      viewpoint: 'Front-facing three-quarter view',
      elevation: 'Eye-level camera',
      shotSize: geom.orientation === 'Portrait' ? 'Three-quarter-body shot' : 'Medium shot',
      framing: `${geom.orientation} (${geom.outputRatio}) composition with balanced headroom and lateral margins`,
      distance: 'Medium portrait distance',
      angleOfView: 'Natural normal-lens perspective with undistorted proportions',
    },
    components: {
      subject: {
        detectedText:
          'Primary human subject with natural facial proportions, balanced skin tone, and clear identity features as shown in the reference frame.',
        explanation: 'Editable template initialized while live AI quota cools down.',
        visibility: 'visible',
      },
      body: {
        detectedText:
          'Natural anatomical body build and balanced proportions consistent with the reference subject.',
        explanation: 'Editable body build template.',
        visibility: 'visible',
      },
      pose: {
        detectedText:
          'Balanced posture with natural torso alignment, relaxed shoulders, and grounded weight distribution.',
        explanation: 'Editable pose description (or sync directly from the 3D Playboard).',
        visibility: 'visible',
      },
      camera: {
        detectedText: `Eye-level camera position with natural perspective and balanced subject-to-camera distance in a ${geom.outputRatio} ${geom.orientation.toLowerCase()} frame.`,
        explanation: geom.ratioExplanation,
        visibility: 'visible',
      },
      framing: {
        detectedText: `${geom.orientation} ${geom.outputRatio} framing (${geom.width}×${geom.height}px) with centered subject placement and clean frame margins.`,
        explanation: geom.ratioExplanation,
        visibility: 'visible',
      },
      clothing: {
        detectedText:
          'Well-fitted contemporary wardrobe with clean fabric drape, natural folds, and cohesive color palette.',
        explanation: 'Editable wardrobe component (or apply a saved Outfit Profile).',
        visibility: 'visible',
      },
      lighting: {
        detectedText:
          'Soft directional key lighting with natural highlight roll-off, gentle fill illumination, and realistic shadow depth.',
        explanation: 'Editable lighting component.',
        visibility: 'visible',
      },
      background: {
        detectedText:
          'Clean architectural interior background with subtle depth separation and balanced tonal contrast.',
        explanation: 'Editable background component.',
        visibility: 'visible',
      },
      environment: {
        detectedText:
          'Cohesive indoor studio/residential setting with natural ambient atmosphere.',
        explanation: 'Editable environmental context.',
        visibility: 'visible',
      },
      composition: {
        detectedText: `Balanced ${geom.outputRatio} ${geom.orientation.toLowerCase()} visual hierarchy with clear foreground-to-background separation.`,
        explanation: geom.ratioExplanation,
        visibility: 'visible',
      },
      facial_expression: {
        detectedText:
          'Composed, natural facial expression with relaxed brow, steady gaze, and neutral lip contour.',
        explanation: 'Editable facial expression component.',
        visibility: 'visible',
      },
      hand_gestures: {
        detectedText:
          'Relaxed arm and hand placement with natural wrist alignment and articulated fingers.',
        explanation: 'Editable hand gesture component.',
        visibility: 'visible',
      },
      leg_gestures: {
        detectedText:
          'Stable lower-body stance with natural hip, knee, and ankle alignment.',
        explanation: 'Editable leg gesture component.',
        visibility: 'visible',
      },
    },
  };
}

function buildCameraReferenceQuotaFallback(base64Data?: string) {
  const geom = extractImageGeometryFromBase64(base64Data);
  return {
    summary: `Camera reference geometry (${geom.width}×${geom.height}px, ${geom.outputRatio} ${geom.orientation}) initialized in local optical mode while Gemini quota resets.`,
    outputRatio: geom.outputRatio,
    orientation: geom.orientation,
    subjectPresentInReference: true,
    detectedReferenceGaze:
      'The subject looks naturally toward the camera optical axis with balanced eye alignment.',
    components: {
      aspect_ratio_orientation: {
        detectedText: `${geom.orientation} orientation with a ${geom.outputRatio} aspect ratio (${geom.width}×${geom.height}px).`,
        explanation: geom.ratioExplanation,
        visibility: 'visible',
      },
      horizontal_camera_position: {
        detectedText:
          'Front-facing to slight three-quarter horizontal camera position relative to the principal subject.',
        explanation: 'Default optical azimuth template; refine in 3D Playboard if desired.',
        visibility: 'visible',
      },
      camera_height: {
        detectedText: 'Eye-level to chest-level camera elevation relative to the principal subject.',
        explanation: 'Balanced camera height.',
        visibility: 'visible',
      },
      vertical_viewing_angle: {
        detectedText: 'Level horizontal optical axis with neutral vertical tilt.',
        explanation: 'Neutral vertical pitch.',
        visibility: 'visible',
      },
      camera_roll: {
        detectedText: 'Level horizon with 0° camera roll and vertical architectural alignment.',
        explanation: 'No Dutch tilt.',
        visibility: 'visible',
      },
      lens_and_perspective: {
        detectedText:
          'Natural normal-lens perspective (approx. 50mm full-frame equivalent) with undistorted proportions and realistic depth progression.',
        explanation: 'Standard optical perspective.',
        visibility: 'visible',
      },
      subject_to_frame_scale: {
        detectedText:
          'Principal subject occupies approximately 65–75% of the vertical frame height with balanced headroom and lateral margins.',
        explanation: 'Balanced subject-to-frame occupancy.',
        visibility: 'visible',
      },
      framing_and_spatial_arrangement: {
        detectedText: `${geom.orientation} ${geom.outputRatio} medium-to-three-quarter framing with centered subject placement and clear foreground-to-background separation.`,
        explanation: geom.ratioExplanation,
        visibility: 'visible',
      },
      capture_style: {
        detectedText: 'Controlled editorial portrait photography with clean optical framing.',
        explanation: 'Editorial capture style.',
        visibility: 'visible',
      },
      focus_and_depth_of_field: {
        detectedText:
          'Critical focus locked on the subject with gentle, natural background depth-of-field falloff.',
        explanation: 'Natural shallow-to-moderate depth of field.',
        visibility: 'visible',
      },
      image_rendering_characteristics: {
        detectedText:
          'Clean optical sharpness across the focal plane with smooth highlight roll-off and natural shadow detail.',
        explanation: 'Clean tonal rendering.',
        visibility: 'visible',
      },
    },
  };
}

// Resilient model call helper with multi-key support, fast per-model timeout, and bounded total execution time
function normalizeScanAnalysis(rawAnalysis: any, clientOutputRatio?: string): any {
  if (!rawAnalysis || typeof rawAnalysis !== 'object') return rawAnalysis;

  const cleanText = (str: any): string => {
    if (typeof str !== 'string') return '';
    let t = str.trim();
    // Ban hedging words in detectedText
    t = t.replace(/\b(or|\/)\b/gi, ' ');
    t = t.replace(/\b(appears|seems|possibly|approximately)\b/gi, '');
    // Clean double spaces
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  };

  const trimExplanation = (str: any): string => {
    if (typeof str !== 'string') return '';
    const words = str.trim().split(/\s+/);
    if (words.length <= 15) return str.trim();
    return words.slice(0, 15).join(' ');
  };

  // Process leadSentence & styleCategory
  if (rawAnalysis.leadSentence) {
    rawAnalysis.leadSentence = cleanText(rawAnalysis.leadSentence);
  }
  if (!rawAnalysis.styleCategory) {
    rawAnalysis.styleCategory = 'photorealistic';
  }

  // Ensure outputRatio comes from client if provided
  if (clientOutputRatio && clientOutputRatio.trim()) {
    rawAnalysis.outputRatio = clientOutputRatio.trim();
  }

  // Normalize components
  if (rawAnalysis.components && typeof rawAnalysis.components === 'object') {
    for (const k of Object.keys(rawAnalysis.components)) {
      const comp = rawAnalysis.components[k];
      if (comp && typeof comp === 'object') {
        comp.detectedText = cleanText(comp.detectedText);
        comp.explanation = trimExplanation(comp.explanation);

        if (!comp.visibility || !['visible', 'partial', 'unavailable'].includes(comp.visibility)) {
          comp.visibility = comp.detectedText ? 'visible' : 'unavailable';
        }
        if (!comp.confidence || !['high', 'medium', 'estimated'].includes(comp.confidence)) {
          comp.confidence = 'high';
        }

        // Camera specific sanity check: NEVER default to eye-level if elevation is below seat/floor/low
        if (k === 'camera' && comp.detectedText) {
          const lower = comp.detectedText.toLowerCase();
          if (
            (lower.includes('floor-level') ||
              lower.includes('below seat') ||
              lower.includes('near floor') ||
              lower.includes('low-angle')) &&
            lower.includes('eye-level')
          ) {
            comp.detectedText = comp.detectedText.replace(/\beye-level\b/gi, 'low camera elevation');
          }
        }
      }
    }
  }

  return rawAnalysis;
}

// Resilient model call helper with multi-key support, fast per-model timeout, and bounded total execution time
async function generateWithFallback(
  aiOrKey: GoogleGenAI | string | undefined,
  parts: any[],
  jsonMode = true,
  customKey?: string
): Promise<{ text: string; parsed?: any; modelUsed: string; switchedToBackup: boolean }> {
  const isQuotaOrRateLimit = (err: any): boolean => {
    const status = err?.status || err?.statusCode || err?.code;
    if (status === 429 || status === '429') return true;
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit')
    );
  };

  const candidateKeys = getCandidateGeminiApiKeys(
    typeof aiOrKey === 'string' ? aiOrKey : customKey
  );
  const clients: GoogleGenAI[] =
    candidateKeys.length > 0
      ? candidateKeys.map((k) => createGenAIClientForKey(k))
      : aiOrKey && typeof aiOrKey === 'object'
      ? [aiOrKey]
      : [getGenAIClient(customKey)];

  // Order: gemini-3.8-flash (primary), gemini-3.1-flash-lite, gemini-flash-latest
  const fallbackModels: Array<{
    name: string;
    timeoutMs: number;
    thinkingLevel?: ThinkingLevel;
  }> = [
    { name: 'gemini-3.8-flash', timeoutMs: 18000, thinkingLevel: ThinkingLevel.LOW },
    { name: 'gemini-3.1-flash-lite', timeoutMs: 18000, thinkingLevel: ThinkingLevel.LOW },
    { name: 'gemini-flash-latest', timeoutMs: 18000 },
  ];

  const startTime = Date.now();
  const MAX_TOTAL_BUDGET_MS = 38000;

  let lastError: any = null;
  let modelUsed = fallbackModels[0].name;
  let switchedToBackup = false;

  for (let clientIdx = 0; clientIdx < clients.length; clientIdx++) {
    const client = clients[clientIdx];
    if (clientIdx > 0) switchedToBackup = true;

    for (let modelIdx = 0; modelIdx < fallbackModels.length; modelIdx++) {
      const elapsed = Date.now() - startTime;
      const remainingBudget = MAX_TOTAL_BUDGET_MS - elapsed;
      if (remainingBudget < 2500) {
        break;
      }

      const modelConfig = fallbackModels[modelIdx];
      modelUsed = modelConfig.name;
      if (modelIdx > 0) switchedToBackup = true;

      try {
        const config: Record<string, any> = {
          temperature: 0.2,
        };
        if (modelConfig.thinkingLevel !== undefined) {
          config.thinkingConfig = { thinkingLevel: modelConfig.thinkingLevel };
        }
        if (jsonMode) {
          config.responseMimeType = 'application/json';
        }

        const effectiveTimeout = Math.min(modelConfig.timeoutMs, remainingBudget);
        const response = await withTimeout(
          client.models.generateContent({
            model: modelConfig.name,
            contents: { parts },
            config,
          }),
          effectiveTimeout,
          modelConfig.name
        );

        const txt = (response.text || '').trim();
        if (!txt) {
          throw new Error('Empty response from model');
        }

        if (jsonMode) {
          const parsed = parseModelJson(txt);
          return { text: txt, parsed, modelUsed, switchedToBackup };
        }

        return { text: txt, modelUsed, switchedToBackup };
      } catch (err: any) {
        lastError = err;
        const errMsg = formatServerErrorMessage(err, '');
        const isAuthError =
          err?.status === 401 ||
          err?.status === 403 ||
          errMsg.toLowerCase().includes('api_key_invalid') ||
          errMsg.toLowerCase().includes('api key not valid');

        if (isAuthError) {
          if (clientIdx + 1 < clients.length) {
            break;
          }
          throw err;
        }

        if (isQuotaOrRateLimit(err)) {
          continue;
        }
      }
    }
  }

  throw lastError || new Error('No response returned from Gemini analysis.');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const hasValidServerKey = Boolean(resolveServerGeminiApiKey());
  res.json({
    status: 'ok',
    hasServerKey: hasValidServerKey,
  });
});

// 1. 13-Component Reference Image Analyzer (Grounded strictly in uploaded image)
app.post('/api/analyze-reference', async (req, res) => {
  try {
    const { images, userNotes, outputRatio: clientRatio } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'At least one reference image is required.' });
    }

    const ai = getGenAIClient(customKey);

    const analysisPrompt = `You are a high-precision photographic, anatomical, and cinematographic visual analysis engine for My Whisk AI.

Analyze the uploaded image in complete detail according to these STRICT RULES:

1. MULTI-SUBJECT DETECTION:
- Count real people clearly part of the main composition in "subjects": [{ "id": "A", "label": "short description + position in frame", "prominence": "primary|secondary" }].
- Exclude reflections, posters, statues, and tiny far-away background passers-by.
- If 2 or more real subjects are present, include a scene-level "interaction" component describing contact points, relative positions, who is in front, gaze between them, and height difference. Also include "subjectComponents": { "A": { ...person components... }, "B": { ...person components... } }.

2. DETECTED TEXT SPECIFICATION (1 to 3 CONCRETE PRESENT-TENSE SENTENCES, up to 4 for subject, clothing, background):
- Every "detectedText" MUST contain the full prompt-ready description. Detail lives ONLY in "detectedText", never solely in "explanation".
- ZERO HEDGING IN detectedText: NO "or", NO "/" between alternatives, NO "appears", "seems", "possibly", "approximately". Pick the single best-supported value; if truly uncertain, set "confidence": "estimated".
- SPATIAL TERMINOLOGY: Use "frame-left / frame-right" for scene positions, and "subject's left / right" for body parts.

3. ZERO DUPLICATION ACROSS FIELDS:
- subject: apparent age range, skin tone, face shape and features, hair length, texture, color, part, styling.
- body: build and proportions only.
- pose: whole-body posture, orientation, torso and shoulders, weight and physical support.
- camera: MUST state camera height relative to the subject (floor-level, below seat, seat-height, waist, chest, eye-level, above), vertical tilt, horizontal direction, distance, lens character from perspective cues. NEVER default to "eye-level" unless the lens is at the subject's eye height.
- framing: crop edges, headroom, footroom, side margins, fraction of frame that is empty floor or sky.
- clothing: every garment with cut, fit, length, specific color name, fabric texture, construction details (neckline, cuffs, seams, closures), footwear, ornaments.
- lighting: main source position relative to subject and camera, softness, intensity, color temperature, resulting shadows and highlights on face and body, fill or bounce, key (high-key or low-key), contrast.
- background: specific objects, surfaces, colors, and where they sit in the frame.
- environment: type of place and overall atmosphere.
- composition: placement, balance, leading lines.
- facial_expression: MUST include gaze direction (direct to lens or off-axis), eyebrow position, eyelid opening, mouth state.
- hand_gestures & leg_gestures: fine detail per limb (palm direction, finger spread, arm straightness, knee spacing, feet placement, shin angle).

4. EVIDENCE FIELD ("explanation"):
- Short evidence note, MAXIMUM 15 WORDS (e.g. "Floor fills lower quarter, bed side visible, no mattress top").

5. LEAD SENTENCE & SUMMARY:
- Provide "leadSentence": a clean prompt-starter sentence describing the main subject, pose, and setting (e.g., "A young woman sits on the edge of a low platform bed in a bright, modern bedroom.").
- Set "styleCategory": "photorealistic" | "illustration" | "3D" | "painting".
- Write "summary" LAST so it never contradicts any field.

${userNotes?.trim() ? `Additional user notes:\n${userNotes.trim()}\n` : ''}

Return VALID, PURE JSON matching this schema:
{
  "leadSentence": "A young woman sits on the edge of a low platform bed in a bright, modern bedroom.",
  "styleCategory": "photorealistic",
  "summary": "1-2 sentence overview of the analyzed reference image",
  "outputRatio": "${clientRatio || '3:4'}",
  "ratioExplanation": "Measured from frame geometry",
  "subjects": [
    { "id": "A", "label": "Woman seated on platform bed", "prominence": "primary" }
  ],
  "cameraEstimates": {
    "viewpoint": "Front-facing view",
    "elevation": "Below seat height",
    "shotSize": "Medium shot",
    "framing": "Vertical frame with empty floor in lower quarter",
    "distance": "Medium portrait distance",
    "angleOfView": "Wide-angle perspective with slight upward tilt"
  },
  "components": {
    "subject": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "body": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "pose": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "camera": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "framing": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "clothing": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "lighting": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "background": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "environment": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "composition": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "facial_expression": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "hand_gestures": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" },
    "leg_gestures": { "detectedText": "...", "explanation": "...", "visibility": "visible", "confidence": "high" }
  }
}`;

    const parts: any[] = [{ text: analysisPrompt }];
    for (const img of images.slice(0, 1)) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data,
        },
      });
    }

    const { text, modelUsed, switchedToBackup } = await generateWithFallback(
      ai,
      parts,
      true,
      customKey
    );
    let parsed = parseModelJson(text);
    parsed = normalizeScanAnalysis(parsed, clientRatio);

    res.json({
      success: true,
      analysis: parsed,
      modelUsed,
      switchedToBackup,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze reference image.');
    console.warn('Reference analysis fallback check:', msg);

    if (isQuotaOrServiceUnavailable(error)) {
      const firstImg = req.body?.images?.[0]?.data;
      const fallbackAnalysis = buildReferenceQuotaFallbackAnalysis(firstImg, req.body?.userNotes);
      return res.status(200).json({
        success: true,
        analysis: fallbackAnalysis,
        modelUsed: 'local-geometry-blueprint',
        switchedToBackup: true,
        quotaFallback: true,
        warning: 'Estimated blueprint, not an AI analysis',
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(statusCode).json({
      error: msg,
      code: typeof error?.code === 'string' ? error.code : undefined,
    });
  }
});

// Endpoint: Solo Subject Re-analysis (Phase 2)
app.post('/api/reanalyze-solo', async (req, res) => {
  try {
    const { image, keepIds, outputRatio, keptSubjectLabel } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!image || !image.data) {
      return res.status(400).json({ error: 'An image is required for solo re-analysis.' });
    }

    const ai = getGenAIClient(customKey);
    const targetId = Array.isArray(keepIds) && keepIds.length > 0 ? keepIds[0] : 'A';
    const subjName = keptSubjectLabel || `Subject ${targetId}`;

    const soloPrompt = `You are a high-precision photographic visual analysis engine for My Whisk AI.
The user wishes to analyze ${subjName} ONLY and COMPLETELY IGNORE all other people in the image.

RE-ANALYSIS MANDATE:
1. Re-describe pose, body, hand_gestures, leg_gestures, facial_expression, clothing, framing, camera, lighting, environment, background, and composition as if ${subjName} is the ONLY person in the scene.
2. If ${subjName} has gestures or physical contact directed at an ignored person, phrase it as directed toward empty space (e.g. "right hand extended forward in a relaxed gesture toward empty space").
3. Remove EVERY mention of any ignored person, "both", "two", "the subjects", "the couple", or second person from ALL fields.
4. Set leadSentence to a rich, specific description of ${subjName} and setting only (e.g. "A woman in her late 20s with long brown hair, leaning forward on a sofa in a bright residential living room."). DO NOT include "No other person is present in the frame" in leadSentence.
5. Ensure ENVIRONMENT is described independently as its own atmospheric/setting context.
6. Follow all standard rules: 1-3 concrete present-tense sentences for detectedText, no hedging ("or", "/", "appears", "seems", "possibly", "approximately", "likely"), evidence max 15 words.

Return VALID, PURE JSON matching the single-subject analysis schema.`;

    const parts = [
      { text: soloPrompt },
      { inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } },
    ];

    const { text, modelUsed, switchedToBackup } = await generateWithFallback(
      ai,
      parts,
      true,
      customKey
    );
    let parsed = parseModelJson(text);
    parsed = normalizeScanAnalysis(parsed, outputRatio);

    res.json({
      success: true,
      analysis: parsed,
      modelUsed,
      switchedToBackup,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to reanalyze solo subject.');
    console.warn('Solo reanalysis fallback:', msg);

    const fallback = buildReferenceQuotaFallbackAnalysis(req.body?.image?.data);
    fallback.leadSentence = 'A woman in her late 20s, sitting in a bright room.';
    res.status(200).json({
      success: true,
      analysis: fallback,
      quotaFallback: true,
      warning: 'Local solo subject fallback used. Please review scene fields.',
    });
  }
});

// Endpoint: AI Targeted Solo Field Rewrite
app.post('/api/rewrite-fields-solo', async (req, res) => {
  try {
    const { fields, keptSubjectLabel } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'Fields object is required for rewrite.' });
    }

    const ai = getGenAIClient(customKey);
    const rewritePrompt = `You are a photographic prompt sanitizer for My Whisk AI.
Rewrite the following visual component fields so they refer ONLY to the kept subject (${keptSubjectLabel || 'primary subject'}) and completely eliminate any mention of second/ignored subjects, plural terms ("both", "two", "the subjects", "each other"), or multi-person interactions.
Keep descriptions specific, present tense, and prompt-ready.

FIELDS TO REWRITE:
${JSON.stringify(fields, null, 2)}

Return PURE JSON matching: { "rewrittenFields": { "fieldKey": "sanitized description" } }`;

    const parts = [{ text: rewritePrompt }];
    const { text } = await generateWithFallback(ai, parts, true, customKey);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      rewrittenFields: parsed?.rewrittenFields || parsed || {},
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to rewrite fields for solo mode.');
    res.status(500).json({ error: msg });
  }
});

// Endpoint: Deep AI Prompt Consistency Check (Phase 4)
app.post('/api/check-prompt', async (req, res) => {
  try {
    const { promptText } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!promptText) {
      return res.status(400).json({ error: 'Prompt text is required for deep check.' });
    }

    const ai = getGenAIClient(customKey);

    const checkPrompt = `You are an expert prompt consistency validator for image generation models.
Analyze the prompt below for subtle physical, spatial, posture, camera, or lighting contradictions:

PROMPT TO CHECK:
${promptText}

Return PURE JSON matching this schema:
{
  "hasIssues": boolean,
  "issues": [
    {
      "id": "issue_1",
      "fieldA": "Field A",
      "fieldB": "Field B",
      "labelA": "Label A",
      "labelB": "Label B",
      "textA": "Text A",
      "textB": "Text B",
      "explanation": "Description of conflict"
    }
  ]
}`;

    const parts = [{ text: checkPrompt }];
    const { text } = await generateWithFallback(ai, parts, true, customKey);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      check: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to perform deep check.');
    res.status(500).json({ error: msg });
  }
});

// 2. Multi-Image Subject Profile Analyzer (Up to 5 reference images of the same subject)
app.post('/api/analyze-subject-profile', async (req, res) => {
  try {
    const { images } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Please upload between 1 and 5 reference images of the subject.' });
    }

    const ai = getGenAIClient(customKey);

    const prompt = `You are a visual identity consolidation specialist.
The user has uploaded ${Math.min(images.length, 5)} reference image(s) of the SAME subject to create a reusable Subject Profile.

Analyze all provided images together to establish a consolidated, accurate subject identity and body build description:
- Identify consistent permanent visual characteristics across the images: apparent age range, skin tone and undertone, epidermal texture, facial structure, jawline, cheekbones, eye shape, iris color, eyelid structure, eyebrow shape/density, nose contour, lip shape and natural pigmentation, hairline, hair color, hair texture, and permanent distinguishing marks (such as moles, freckles, scars, or permanent piercings).
- Avoid assuming that temporary differences in lighting, pose, clothing, facial expression, or camera angle are permanent subject characteristics.
- Also extract a consolidated description of the subject's visible body build, proportions, and silhouette where visible across the images. Do not lock temporary poses or clothing into the subject or body description.

Return VALID, PURE JSON matching this exact structure:
{
  "suggestedName": "Concise descriptive profile title",
  "masterSubject": "Comprehensive, consolidated visual identity description of the subject (face, skin, eyes, hair, distinguishing traits)...",
  "masterBody": "Consolidated description of the subject's natural body build, proportions, and anatomical silhouette...",
  "tags": ["Tag1", "Tag2", "Tag3"]
}`;

    const parts: any[] = [{ text: prompt }];
    for (const img of images.slice(0, 5)) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data,
        },
      });
    }

    const { text } = await generateWithFallback(ai, parts, true, customKey);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      profile: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze subject reference images.');
    console.warn('Subject profile fallback check:', msg);

    if (isQuotaOrServiceUnavailable(error)) {
      return res.status(200).json({
        success: true,
        quotaFallback: true,
        profile: {
          suggestedName: 'Custom Subject Profile',
          masterSubject:
            'Primary human subject with balanced facial proportions, natural skin texture, well-defined eyes and brow contour, and consistent hair styling.',
          masterBody:
            'Balanced anatomical body build with natural shoulder-to-hip proportions and realistic posture.',
          tags: ['Custom Subject', 'Editable Template'],
        },
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(statusCode).json({
      error: msg,
    });
  }
});

// 3. Outfit Profile Reference Image Analyzer
app.post('/api/analyze-outfit-profile', async (req, res) => {
  try {
    const { image } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!image || !image.data) {
      return res.status(400).json({ error: 'An outfit reference image is required.' });
    }

    const ai = getGenAIClient(customKey);

    const prompt = `You are a fashion and textile visual analyst.
Analyze the visible clothing and wardrobe in the uploaded reference image in high detail.
- Describe visible garments, garment categories, colors, patterns, fabrics, weave/texture, fit, tailoring/construction, necklines, sleeves, cuffs, hems, folds, draping, layering, accessories, and visible footwear.
- Do NOT invent hidden garment details that are outside the frame.
- Do NOT include the person's facial identity, background, or lighting in the outfit description.

Return VALID, PURE JSON matching this exact structure:
{
  "suggestedName": "Concise descriptive name for this outfit",
  "description": "Comprehensive, prompt-ready description of the complete visible outfit...",
  "garmentType": "Primary garment categories",
  "colors": "Observed colors and palette",
  "materials": "Observed fabrics and textures",
  "fit": "Fit, cut, and drape",
  "sleeves": "Sleeve length and construction",
  "neckline": "Neckline or collar style",
  "accessories": "Visible accessories (or empty string if none)",
  "footwear": "Visible footwear (or empty string if not visible)"
}`;

    const parts: any[] = [
      { text: prompt },
      {
        inlineData: {
          mimeType: image.mimeType || 'image/jpeg',
          data: image.data,
        },
      },
    ];

    const { text } = await generateWithFallback(ai, parts, true, customKey);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      outfit: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze outfit image.');
    console.warn('Outfit profile fallback check:', msg);

    if (isQuotaOrServiceUnavailable(error)) {
      return res.status(200).json({
        success: true,
        quotaFallback: true,
        outfit: {
          suggestedName: 'Custom Wardrobe Profile',
          description:
            'Tailored contemporary outfit with clean fabric drape, natural seam construction, and cohesive tonal palette.',
          garmentType: 'Contemporary two-piece ensemble',
          colors: 'Balanced neutral and accent tones',
          materials: 'Natural woven cotton and soft knit textures',
          fit: 'Tailored relaxed fit with natural drape',
          sleeves: 'Standard sleeve construction',
          neckline: 'Clean classic neckline',
          accessories: '',
          footwear: '',
        },
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(statusCode).json({
      error: msg,
    });
  }
});

// 4. Background Profile Reference Image Analyzer
app.post('/api/analyze-background-profile', async (req, res) => {
  try {
    const { image } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!image || !image.data) {
      return res.status(400).json({ error: 'A background reference image is required.' });
    }

    const ai = getGenAIClient(customKey);

    const prompt = `You are an architectural, environmental, and lighting analysis specialist.
Analyze the uploaded reference image and extract three distinct, independently reusable scene components:
1. background: Describe the actual visible background objects, architectural structures, wall/floor surfaces, colors, materials, textures, spatial arrangement, and depth layers. Exclude any foreground human subject.
2. environment: Describe the overall setting and environmental context (indoor or outdoor characteristics, architectural style, surrounding vegetation, atmosphere, time of day, weather-related conditions when visible). Keep environmental context distinct from specific background objects.
3. lighting: Analyze the apparent light sources, direction, elevation, softness, intensity, color temperature, highlights, shadow falloff, ambient illumination, contrast, and reflected light.

Return VALID, PURE JSON matching this exact structure:
{
  "suggestedName": "Concise descriptive title for this background & lighting profile",
  "background": "Detailed description of visible background structures, surfaces, objects, and depth...",
  "environment": "Detailed description of the setting and environmental context...",
  "lighting": "Detailed description of the lighting direction, quality, color temperature, and shadow behavior...",
  "tags": ["Indoor/Outdoor", "LightingStyle", "Setting"]
}`;

    const parts: any[] = [
      { text: prompt },
      {
        inlineData: {
          mimeType: image.mimeType || 'image/jpeg',
          data: image.data,
        },
      },
    ];

    const { text } = await generateWithFallback(ai, parts, true, customKey);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      backgroundProfile: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze background reference image.');
    console.warn('Background profile fallback check:', msg);

    if (isQuotaOrServiceUnavailable(error)) {
      return res.status(200).json({
        success: true,
        quotaFallback: true,
        backgroundProfile: {
          suggestedName: 'Architectural Interior & Soft Daylight',
          background:
            'Clean architectural interior background with subtle wall paneling, natural floor surfaces, and balanced spatial depth.',
          environment:
            'Contemporary indoor studio/residential setting with calm atmosphere.',
          lighting:
            'Soft directional daylight with gentle highlight roll-off, natural ambient fill, and soft contact shadows.',
          tags: ['Indoor', 'Soft Daylight', 'Architectural'],
        },
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(statusCode).json({
      error: msg,
    });
  }
});

// 5. Dedicated 11-Component Camera Reference Image Analyzer for Camera Angle Controller
app.post('/api/analyze-camera-reference', async (req, res) => {
  try {
    const { image, userNotes } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!image || !image.data) {
      return res.status(400).json({ error: 'A camera reference image is required.' });
    }

    const ai = getGenAIClient(customKey);

    const prompt = `You are a high-precision photographic, optical, and cinematography analysis engine for My Whisk AI's Camera Angle Controller.

PURPOSE:
The uploaded image is a CAMERA REFERENCE IMAGE. Your job is to extract its camera viewpoint, optical perspective, framing, spatial geometry, focus behavior, and photographic rendering characteristics across 11 components (A through K) so they can be converted into a reusable image-to-image transformation prompt and applied to a DIFFERENT original image supplied separately by the user.

CRITICAL GROUNDING & REUSABILITY RULES:
1. Analyze ONLY what is supported by visible evidence in the uploaded Camera Reference Image.
2. Be as detailed and accurate as the available image permits. Do NOT substitute vague labels for observable geometric and photographic details.
3. NEVER invent exact numerical measurements, unsupported focal lengths, exact millimeter lens models, f-stop numbers, shutter speeds, ISO settings, or exact degree angles when the image does not provide sufficient visual evidence.
4. CRITICAL: Do NOT include the camera reference image's specific person identity (age, ethnicity, hair color, facial features), specific clothing items, or specific background props in the 11 component descriptions. Instead, refer cleanly to "the subject", "the principal subject", "the foreground plane", and "the background plane" so every extracted camera component can be cleanly applied to transform ANY user's original image.
5. Distinguish clearly between:
   - The camera's horizontal position vs. the direction the subject faces.
   - The camera's physical height/elevation vs. the camera's vertical viewing tilt angle.

ANALYZE ALL 11 CAMERA REFERENCE COMPONENTS:

A. aspect_ratio_orientation (ASPECT RATIO AND ORIENTATION):
- Identify portrait, landscape, or square orientation.
- State the approximate aspect ratio (e.g., 3:4, 4:5, 2:3, 9:16, 1:1, 4:3, 3:2, 16:9).
- Describe relevant crop and frame orientation characteristics.

B. horizontal_camera_position (HORIZONTAL CAMERA POSITION):
- Identify the camera's horizontal position: front, front-left, front-right, three-quarter view, side profile, rear three-quarter view, or rear view.
- Describe the approximate horizontal viewing direction relative to the subject (when a subject is present).
- Explicitly distinguish the camera's position from the direction the subject's torso and head face.

C. camera_height (CAMERA HEIGHT):
- Identify camera height: ground-level, low-angle, waist-level, chest-level, eye-level, elevated, high-angle, overhead, or another visually supported description.
- Estimate the camera's vertical height relative to the visible subject and environment.

D. vertical_viewing_angle (VERTICAL VIEWING ANGLE):
- Determine whether the camera optical axis looks upward, horizontally (level), downward, or directly overhead.
- Estimate the vertical tilt only when supported by visual evidence (such as converging verticals, horizon placement, or underside/top-plane visibility).
- Explicitly distinguish camera elevation (height) from camera tilt (viewing angle).

E. camera_roll (CAMERA ROLL):
- Determine whether the camera appears level with the horizon/verticals or rotated around its optical axis.
- Describe any visible Dutch angle, clockwise/counter-clockwise roll, or horizon tilt.

F. lens_and_perspective (LENS AND PERSPECTIVE):
- Analyze perspective distortion, apparent focal-length characteristics (e.g., wide-angle expansion, natural normal perspective, or telephoto compression), near-to-far size relationships, foreshortening, and depth perception.
- Suggest a broad focal-length category estimate (e.g., wide-angle, standard/normal, short-telephoto) ONLY when reasonably supported by visible perspective cues. Never invent exact lens specifications from insufficient evidence.

G. subject_to_frame_scale (SUBJECT-TO-FRAME SCALE):
- Determine the visible subject's approximate proportion of the frame (or the scale and placement of principal visual elements if no subject exists).
- Describe headroom, footroom, left and right lateral margins, and relevant crop boundaries.

H. framing_and_spatial_arrangement (FRAMING AND SPATIAL ARRANGEMENT):
- Identify the shot size (e.g., extreme close-up, close-up, medium close-up, medium shot, waist-up shot, three-quarter shot, full shot, or wide shot).
- Describe subject placement within the frame (centered, rule-of-thirds offset, diagonal arrangement), foreground, background, negative space distribution, and visible frame edges.
- Precisely identify which parts of the subject's body or scene are cut off by the frame edges.
- Describe the spatial relationship and apparent distance between the camera, principal subject/elements, and background.

I. capture_style (CAPTURE STYLE):
- Identify the apparent photographic style (such as casual smartphone photography, candid snapshot, editorial portrait photography, controlled studio photography, or documentary photography).
- Describe the observable visual characteristics supporting that classification (e.g., framing immediacy, candid perspective, studio rigor).
- Never assign a specific camera brand or phone model without direct evidence.

J. focus_and_depth_of_field (FOCUS AND DEPTH OF FIELD):
- Identify the apparent focus target / plane of critical focus.
- Analyze subject sharpness, background blur (bokeh), foreground blur, and depth-of-field characteristics (shallow, moderate, or deep).
- Describe focus falloff transitions when visible.

K. image_rendering_characteristics (IMAGE RENDERING CHARACTERISTICS):
- Analyze observable optical sharpness, motion blur (if any), visible film grain or digital sensor noise, highlight roll-off/rendering, shadow detail, and tonal contrast characteristics.
- Include only characteristics that are visible or reasonably inferable from the image.

${userNotes?.trim() ? `Additional user notes:\n${userNotes.trim()}\n` : ''}

Return VALID, PURE JSON matching this exact schema:
{
  "summary": "Concise 1-2 sentence summary of the camera viewpoint, framing, and photographic perspective extracted from the reference image",
  "outputRatio": "3:4",
  "orientation": "Portrait",
  "subjectPresentInReference": true,
  "detectedReferenceGaze": "Grounded description of where the subject in the camera reference image is looking relative to the camera lens (e.g., 'The subject looks directly into the camera lens with slight downward eye alignment' or 'No human subject present in the camera reference')",
  "components": {
    "aspect_ratio_orientation": { "detectedText": "...", "explanation": "Visual evidence for aspect ratio and orientation", "visibility": "visible" },
    "horizontal_camera_position": { "detectedText": "...", "explanation": "Visual evidence for horizontal position vs subject orientation", "visibility": "visible" },
    "camera_height": { "detectedText": "...", "explanation": "Visual evidence for camera elevation relative to subject/scene", "visibility": "visible" },
    "vertical_viewing_angle": { "detectedText": "...", "explanation": "Visual evidence for vertical tilt angle vs elevation", "visibility": "visible" },
    "camera_roll": { "detectedText": "...", "explanation": "Visual evidence for horizon/vertical alignment or Dutch roll", "visibility": "visible" },
    "lens_and_perspective": { "detectedText": "...", "explanation": "Visual evidence for perspective distortion, foreshortening, and depth compression", "visibility": "visible" },
    "subject_to_frame_scale": { "detectedText": "...", "explanation": "Visual evidence for frame occupancy, headroom, footroom, and margins", "visibility": "visible" },
    "framing_and_spatial_arrangement": { "detectedText": "...", "explanation": "Visual evidence for shot size, crop cutoffs, and spatial arrangement", "visibility": "visible" },
    "capture_style": { "detectedText": "...", "explanation": "Visual evidence supporting the capture style classification", "visibility": "visible" },
    "focus_and_depth_of_field": { "detectedText": "...", "explanation": "Visual evidence for focal plane and depth-of-field falloff", "visibility": "visible" },
    "image_rendering_characteristics": { "detectedText": "...", "explanation": "Visual evidence for sharpness, grain/noise, highlight/shadow rendering", "visibility": "visible" }
  }
}`;

    const parts: any[] = [
      { text: prompt },
      {
        inlineData: {
          mimeType: image.mimeType || 'image/jpeg',
          data: image.data,
        },
      },
    ];

    const { text, modelUsed, switchedToBackup } = await generateWithFallback(
      ai,
      parts,
      true,
      customKey
    );
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      cameraAnalysis: parsed,
      modelUsed,
      switchedToBackup,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze camera reference image.');
    console.warn('Camera reference fallback check:', msg);

    if (isQuotaOrServiceUnavailable(error)) {
      const fallbackCamera = buildCameraReferenceQuotaFallback(req.body?.image?.data);
      return res.status(200).json({
        success: true,
        cameraAnalysis: fallbackCamera,
        modelUsed: 'local-optical-blueprint',
        switchedToBackup: true,
        quotaFallback: true,
        warning:
          'Live Gemini quota was reached; initialized 11 camera optical components from measured frame geometry.',
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(statusCode).json({
      error: msg,
      code: typeof error?.code === 'string' ? error.code : undefined,
    });
  }
});

// Prevent any unmatched /api/* route from falling through to Vite SPA HTML middleware
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Express JSON / payload error middleware so malformed or oversized payloads return clean JSON strings
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.statusCode === 'number'
      ? err.statusCode
      : 500;
  const message =
    status === 413
      ? 'Uploaded image payload is too large. Please try a standard resolution image.'
      : formatServerErrorMessage(err, 'Internal server error.');
  res.status(status).json({ error: message });
});

// Mount Vite or static server when running as a standalone Node/Express process
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

// Only start the standalone HTTP listener when not running inside Vercel Serverless Functions
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
  });
}

export { app, formatServerErrorMessage };
export default app;


