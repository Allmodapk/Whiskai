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

function resolveServerGeminiApiKey(customKey?: string): string {
  const cleanServer = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim();
  const cleanCustom = customKey ? customKey.trim() : '';
  // Prefer valid server-side GEMINI_API_KEY; allow customKey if server key is absent
  if (cleanServer && cleanServer !== 'MY_GEMINI_API_KEY') {
    return cleanServer;
  }
  if (cleanCustom && cleanCustom !== 'MY_GEMINI_API_KEY') {
    return cleanCustom;
  }
  return '';
}

// Helper to get GoogleGenAI client with user-agent
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
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Helper to enforce a timeout on individual model calls so fallback models can run before client timeout
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      err.code = 'MODEL_TIMEOUT';
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

// Resilient model call helper with fallback ladder and low-latency thinking configuration
async function generateWithFallback(
  ai: GoogleGenAI,
  parts: any[],
  jsonMode = true
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

  const isRetryableError = (err: any): boolean => {
    const status = err?.status || err?.statusCode || err?.code;
    if (
      status === 503 ||
      status === '503' ||
      status === 504 ||
      status === 500 ||
      status === 'MODEL_TIMEOUT'
    ) {
      return true;
    }
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('service unavailable') ||
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('deadline') ||
      msg.includes('valid json') ||
      msg.includes('empty response')
    );
  };

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Prioritize gemini-3.1-flash-lite with MINIMAL thinking for fast multimodal JSON extraction,
  // with gemini-3.8-flash and gemini-flash-latest as resilient fallbacks
  const fallbackModels: Array<{
    name: string;
    retries: number;
    timeoutMs: number;
    thinkingLevel?: ThinkingLevel;
  }> = [
    { name: 'gemini-3.1-flash-lite', retries: 1, timeoutMs: 28000, thinkingLevel: ThinkingLevel.MINIMAL },
    { name: 'gemini-3.8-flash', retries: 1, timeoutMs: 28000, thinkingLevel: ThinkingLevel.LOW },
    { name: 'gemini-flash-latest', retries: 1, timeoutMs: 28000 },
  ];

  let lastError: any = null;
  let modelUsed = fallbackModels[0].name;
  let switchedToBackup = false;

  for (const modelConfig of fallbackModels) {
    modelUsed = modelConfig.name;
    let attempt = 0;

    while (attempt <= modelConfig.retries) {
      try {
        const config: Record<string, any> = {};
        if (modelConfig.thinkingLevel !== undefined) {
          config.thinkingConfig = { thinkingLevel: modelConfig.thinkingLevel };
        }
        if (jsonMode) {
          config.responseMimeType = 'application/json';
        }

        const response = await withTimeout(
          ai.models.generateContent({
            model: modelConfig.name,
            contents: { parts },
            config,
          }),
          modelConfig.timeoutMs,
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
          throw err;
        }
        if (isQuotaOrRateLimit(err)) {
          break;
        }
        if (isRetryableError(err)) {
          attempt++;
          if (attempt <= modelConfig.retries) {
            await delay(500 * attempt);
          }
        } else {
          break;
        }
      }
    }
    switchedToBackup = true;
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
    const { images, userNotes } = req.body;
    const customKey = req.headers['x-gemini-key'] as string | undefined;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'At least one reference image is required.' });
    }

    const ai = getGenAIClient(customKey);

    const analysisPrompt = `You are a high-precision photographic and anatomical visual analysis engine for My Whisk AI.

Analyze the uploaded image at the highest practical level of visual detail.
CRITICAL GROUNDING RULE:
- Do NOT use preset descriptions or external defaults. Every extracted description MUST be grounded strictly in the actual uploaded image.
- Do NOT invent details that cannot be established from the image.
- Distinguish observed characteristics from uncertain inferences.

VISIBILITY RULES (MANDATORY):
- Analyze only the components supported by the uploaded image.
- If a component is entirely outside the frame or cannot be meaningfully observed (for example: legs in a chest-up portrait, hands cropped out or completely hidden, or a face outside the frame), mark its "visibility" as "unavailable", set "detectedText" to "", and explain why in "explanation" (e.g., "Outside frame in chest-up crop").
- If a component is partially visible, set "visibility" to "partial" and describe ONLY what can reasonably be established from the visible portion.
- If clearly visible, set "visibility" to "visible".

EXTRACT ALL 13 COMPONENTS:

1. subject:
Describe the visible subject's relevant characteristics, including apparent age range, skin tone, visible facial features, hairstyle, hair texture, and other distinguishing visual characteristics. Prioritize visual accuracy and identity consistency. Do not invent details that cannot be established from the image.

2. body:
Describe visible body proportions, silhouette, build, anatomical relationships, and body geometry as accurately as the image permits. Distinguish observed characteristics from uncertain inferences.

3. pose:
Analyze the complete visible pose, including body orientation, torso rotation, shoulder alignment, head tilt, weight distribution, balance, joint articulation, limb positions, and points of physical support. Describe the actual spatial relationships between body parts instead of relying on vague descriptions.

4. camera:
Analyze:
- Camera viewpoint and horizontal viewing direction (e.g., front-facing view, three-quarter view, side profile, rear view).
- Camera elevation relative to the subject (e.g., eye-level camera, low-angle shot, high-angle shot, upward-looking, downward-looking).
- Apparent camera-to-subject distance.
- Shot size and perspective characteristics.
- Lens or focal-length characteristics when reasonably inferable (use descriptive terminology; NEVER invent unsupported numerical focal lengths or exact angle degrees).
- Perspective distortion and visible spatial relationships.

5. framing:
Precisely describe:
- Shot size (full-body, three-quarter-body, half-body, waist-up, chest-up, portrait, close-up).
- Which body parts are visible and where the image frame cuts off the subject.
- Subject placement within the frame, headroom, footroom, and lateral margins.
- Subject scale relative to the image, foreground/background spacing, aspect ratio, and crop characteristics.

6. clothing:
Describe visible garments, garment categories, colors, patterns, fabrics, textures, fit, construction, necklines, sleeves, hems, folds, draping, layering, accessories, and footwear if visible. Do not invent hidden garment details.

7. lighting:
Analyze the apparent light source, direction, elevation, softness, intensity, color temperature, highlights, shadows, ambient illumination, contrast, reflected light, and shadow behavior. Distinguish clearly visible lighting characteristics from uncertain inferences.

8. background:
Describe the actual visible background, including objects, structures, surfaces, colors, textures, spatial arrangement, and depth.

9. environment:
Describe the apparent setting and environmental context, including indoor or outdoor characteristics, architectural elements, surrounding vegetation, weather-related conditions when visible, and contextual details. Keep environmental observations separate from individual background objects.

10. composition:
Analyze the overall arrangement of the subject and surrounding elements, visual balance, subject placement, negative space, leading lines, depth layers, visual hierarchy, and compositional characteristics.

11. facial_expression:
Analyze the visible facial expression at a detailed physical level:
- Eyebrow position and shape.
- Eyelid position and degree of eye opening.
- Gaze direction, eye tension, and visible muscle engagement.
- Mouth opening and shape, lip contour, rounding, stretching, and compression.
- Visible teeth and tongue, when applicable.
- Cheek tension, symmetry or asymmetry, and the combined physical configuration of visible facial features.
Describe the actual physical configuration rather than vague emotion labels ("happy", "sad", "surprised") alone. If the face is outside the frame or obscured, mark visibility as "unavailable".

12. hand_gestures:
Analyze each visible arm, wrist, hand, palm, and finger configuration independently:
- Left and right arm positions, upper-arm and forearm orientation, elbow flexion or extension.
- Wrist orientation and bending, palm orientation relative to camera and body.
- Finger positions, separation, curling, extension, and thumb placement.
- Hand shape, contact with body/clothing/furniture/objects, and whether the hand supports weight, rests, grips, points, or reaches.
- Spatial relationship between each arm and the rest of the body.
If hands/arms are outside the frame, mark visibility as "unavailable".

13. leg_gestures:
Analyze each visible leg independently:
- Thigh and lower-leg orientation, hip, knee, and ankle positioning, knee flexion or extension.
- Foot direction and placement, leg crossing, separation, bending, and extension.
- Weight-bearing relationships and contact with ground, furniture, or surfaces.
- Spatial relationship between both legs and torso, plus visible footwear and its relationship to foot positioning.
If legs are outside the frame (e.g., waist-up or close-up shot), mark visibility as "unavailable".

${userNotes?.trim() ? `Additional user context:\n${userNotes.trim()}\n` : ''}

Return VALID, PURE JSON matching this exact schema:
{
  "summary": "Concise 1-2 sentence overview of the analyzed reference image",
  "outputRatio": "3:4",
  "ratioExplanation": "Justification for the aspect ratio based on frame geometry",
  "cameraEstimates": {
    "viewpoint": "e.g. Three-quarter view",
    "elevation": "e.g. Eye-level camera",
    "shotSize": "e.g. Waist-up shot",
    "framing": "Detailed framing summary",
    "distance": "e.g. Medium portrait distance",
    "angleOfView": "e.g. Natural normal perspective"
  },
  "components": {
    "subject": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "body": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "pose": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "camera": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "framing": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "clothing": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "lighting": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "background": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "environment": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "composition": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "facial_expression": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "hand_gestures": { "detectedText": "...", "explanation": "...", "visibility": "visible" },
    "leg_gestures": { "detectedText": "...", "explanation": "...", "visibility": "visible" }
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

    const { text, modelUsed, switchedToBackup } = await generateWithFallback(ai, parts, true);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      analysis: parsed,
      modelUsed,
      switchedToBackup,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze reference image.');
    console.error('Error analyzing reference:', msg);
    const isQuota =
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.toLowerCase().includes('quota') ||
      error?.status === 429;
    const is503 =
      error?.status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE');

    if (is503) {
      return res.status(503).json({
        error: 'Gemini is temporarily experiencing high demand. Please try again shortly.',
        code: 'UNAVAILABLE_ALL_MODELS',
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : isQuota
        ? 429
        : 500;
    res.status(statusCode).json({
      error: isQuota
        ? 'Your AI service quota has been reached. Please wait a few moments and retry.'
        : msg,
      code: typeof error?.code === 'string' ? error.code : undefined,
    });
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

    const { text } = await generateWithFallback(ai, parts, true);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      profile: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze subject reference images.');
    console.error('Error analyzing subject profile:', msg);
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

    const { text } = await generateWithFallback(ai, parts, true);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      outfit: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze outfit image.');
    console.error('Error analyzing outfit profile:', msg);
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

    const { text } = await generateWithFallback(ai, parts, true);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      backgroundProfile: parsed,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze background reference image.');
    console.error('Error analyzing background profile:', msg);
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

    const { text, modelUsed, switchedToBackup } = await generateWithFallback(ai, parts, true);
    const parsed = parseModelJson(text);

    res.json({
      success: true,
      cameraAnalysis: parsed,
      modelUsed,
      switchedToBackup,
    });
  } catch (error: any) {
    const msg = formatServerErrorMessage(error, 'Failed to analyze camera reference image.');
    console.error('Error analyzing camera reference:', msg);
    const isQuota =
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.toLowerCase().includes('quota') ||
      error?.status === 429;
    const is503 =
      error?.status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE');

    if (is503) {
      return res.status(503).json({
        error: 'Gemini is temporarily experiencing high demand. Please try again shortly.',
        code: 'UNAVAILABLE_ALL_MODELS',
      });
    }

    const statusCode =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : isQuota
        ? 429
        : 500;
    res.status(statusCode).json({
      error: isQuota
        ? 'Your AI service quota has been reached. Please wait a few moments and retry.'
        : msg,
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


