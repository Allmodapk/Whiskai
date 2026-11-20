import type { CameraAiBaseAnalysis, ImageDataItem } from '../../types';
import { postApiJson } from '../apiClient';
import { StorageService } from '../storage';
import type {
  ConfidenceLevel,
  GeminiFallbackReason,
  SourceImageAnalysis,
} from './types';

function scoreToConfidence(score: unknown): ConfidenceLevel {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'low';
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function clampNumeric(val: unknown, min: number, max: number): number | null {
  if (typeof val !== 'number' || Number.isNaN(val)) return null;
  return Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
}

export interface MapSourceAnalysisOptions {
  isFallbackEstimate?: boolean;
  warningMessage?: string;
  modelUsed?: string;
  fallbackReason?: GeminiFallbackReason;
  quotaCause?: string;
}

/**
 * Maps raw /api/camera-ai/analyze-base response into an honest SourceImageAnalysis.
 * Strictly separates Gemini-verified visual observations from unverified local fallback estimates
 * so uncertain local defaults are never misrepresented as high-confidence facts.
 */
export function mapBaseAnalysisToSourceAnalysis(
  raw: CameraAiBaseAnalysis,
  imageName: string,
  options: MapSourceAnalysisOptions = {}
): SourceImageAnalysis {
  const cam = raw.current_camera;
  const isFallback = Boolean(options.isFallbackEstimate);
  const measuredAspectRatio =
    cam?.framing?.aspect_ratio && cam.framing.aspect_ratio.trim()
      ? cam.framing.aspect_ratio.trim()
      : 'Unknown';

  if (isFallback) {
    return {
      analyzedAt: Date.now(),
      imageName,
      isFallbackEstimate: true,
      analysisOrigin: 'local_fallback',
      modelUsed: options.modelUsed || 'local-optical-blueprint',
      fallbackReason: options.fallbackReason || 'quota_exhausted',
      quotaCause: options.quotaCause,
      warningMessage:
        options.warningMessage ||
        'Live Gemini quota reached; local fallback used (reduced accuracy — review values or retry Gemini).',
      observable: {
        subjectDescription:
          'Unverified locally (Gemini visual analysis unavailable — inspect attached primary image directly)',
        poseAndOrientation:
          'Unverified locally (preserve exact body pose and world orientation visible in attached primary image)',
        headAndGaze:
          'Unverified locally (preserve exact head angle and eye gaze visible in attached primary image)',
        expressionAndFeatures:
          'Preserve facial identity, hairstyle, skin texture, and expression directly from attached primary image',
        clothingAndAccessories:
          'Unverified locally (preserve exact garments and accessories visible in attached primary image)',
        environmentAndBackground:
          'Unverified locally (preserve exact background and environment visible in attached primary image)',
        lightingAndShadows:
          'Unverified locally (preserve exact lighting direction and shadows visible in attached primary image)',
        aspectRatioDetected: measuredAspectRatio,
        framingDescription:
          'Exact crop boundaries and visible body extent could not be verified locally — preserve the original source crop and visible body extent directly shown in the attached primary image',
      },
      inferredCamera: {
        azimuthDeg: {
          value: null,
          rangeMin: null,
          rangeMax: null,
          confidence: 'unknown',
          note: 'Unavailable in local fallback — inspect attached primary image or enter manually',
        },
        elevationDeg: {
          value: null,
          rangeMin: null,
          rangeMax: null,
          confidence: 'unknown',
          note: 'Unavailable in local fallback — inspect attached primary image or enter manually',
        },
        distanceLabel: 'uncertain (local fallback)',
        distanceConfidence: 'unknown',
        focalLengthMm: {
          value: null,
          rangeMin: null,
          rangeMax: null,
          confidence: 'unknown',
          note: 'Unavailable in local fallback — inspect attached primary image or enter manually',
        },
        perspectiveCharacter:
          'Uncertain (local fallback — match optical perspective cues directly from attached primary image)',
        shotSize: 'Uncertain (preserve original source crop & visible body extent)',
        shotSizeConfidence: 'unknown',
        subjectPlacement: 'Unverified locally (preserve source image placement & margins)',
        subjectScalePct: null,
        summary:
          'Local fallback used because Gemini visual analysis did not complete. Starting camera angles and shot size are unverified; inspect the attached primary image directly or enter known values manually.',
      },
      mustNotChange: [
        'Subject identity and recognizable features visible in the primary image',
        'Original body posture, orientation, head angle, and gaze visible in the primary image',
        'Original clothing, materials, and accessories visible in the primary image',
        'Original source crop boundaries, headroom, and visible body extent',
        'Environment, background details, lighting direction, and shadow placement',
      ],
      occlusionNotes: [
        'Exact occlusion boundaries were not analyzed by Gemini; reveal side/rear details only within the original source crop and consistent with the attached primary image.',
      ],
      userConfirmedEdits: false,
    };
  }

  const azVal = clampNumeric(cam?.azimuth_deg, -180, 180);
  const azMin = clampNumeric(cam?.azimuth_range?.[0], -180, 180);
  const azMax = clampNumeric(cam?.azimuth_range?.[1], -180, 180);

  // Server pitch_deg: negative = looking down (camera elevated). Our elevationDeg = -pitch_deg.
  const rawPitch = typeof cam?.pitch_deg === 'number' ? cam.pitch_deg : null;
  const elVal = rawPitch !== null ? clampNumeric(-rawPitch, -65, 85) : null;
  const elRange0 =
    typeof cam?.pitch_range?.[1] === 'number' ? clampNumeric(-cam.pitch_range[1], -65, 85) : null;
  const elRange1 =
    typeof cam?.pitch_range?.[0] === 'number' ? clampNumeric(-cam.pitch_range[0], -65, 85) : null;

  const flVal = clampNumeric(cam?.focal_length_mm, 14, 200);
  const flMin = clampNumeric(cam?.focal_length_range?.[0], 14, 200);
  const flMax = clampNumeric(cam?.focal_length_range?.[1], 14, 200);

  const rawShotSize = typeof cam?.shot_size === 'string' ? cam.shot_size.trim() : '';
  const hasReliableShotSize =
    Boolean(rawShotSize) &&
    !['unknown', 'uncertain', 'n/a', 'none'].includes(rawShotSize.toLowerCase());

  return {
    analyzedAt: Date.now(),
    imageName,
    isFallbackEstimate: false,
    analysisOrigin: 'gemini_verified',
    modelUsed: options.modelUsed,
    warningMessage: options.warningMessage,
    observable: {
      subjectDescription: raw.subject_type_and_count || 'Subject visible in uploaded image',
      poseAndOrientation: raw.pose || 'Observable posture in source frame',
      headAndGaze: `${raw.head_orientation || 'Head angle visible'}; ${raw.gaze_direction || 'gaze direction visible'}`,
      expressionAndFeatures:
        'Preserve facial identity, hairstyle, skin texture, and expression as shown in source photo',
      clothingAndAccessories: raw.clothing_details || 'Wardrobe details visible in source frame',
      environmentAndBackground:
        raw.environment_and_background || 'Scene environment visible in source frame',
      lightingAndShadows:
        raw.lighting_details || 'Lighting direction and shadow contrast visible in source frame',
      aspectRatioDetected: measuredAspectRatio,
      framingDescription:
        [cam?.framing?.subject_position_in_frame, cam?.framing?.headroom, cam?.framing?.crop_behavior]
          .filter(Boolean)
          .join(' · ') || 'Framing observed directly in uploaded image',
    },
    inferredCamera: {
      azimuthDeg: {
        value: azVal,
        rangeMin: azMin,
        rangeMax: azMax,
        confidence: scoreToConfidence(cam?.azimuth_confidence),
        note:
          cam?.azimuth_reference_axis ||
          'Estimated horizontal angle relative to subject facing direction',
      },
      elevationDeg: {
        value: elVal,
        rangeMin: elRange0 !== null && elRange1 !== null ? Math.min(elRange0, elRange1) : null,
        rangeMax: elRange0 !== null && elRange1 !== null ? Math.max(elRange0, elRange1) : null,
        confidence: scoreToConfidence(cam?.pitch_confidence),
        note: `${cam?.camera_height || 'Inferred camera height'} (${cam?.pitch_label || 'estimated tilt'})`,
      },
      distanceLabel: cam?.distance_label || 'uncertain',
      distanceConfidence: scoreToConfidence(cam?.distance_confidence),
      focalLengthMm: {
        value: flVal,
        rangeMin: flMin,
        rangeMax: flMax,
        confidence: scoreToConfidence(cam?.focal_length_confidence),
        note: `${cam?.focal_length_label || 'estimated lens'} · ${cam?.distortion_character || 'inferred perspective compression'}`,
      },
      perspectiveCharacter:
        cam?.perspective_strength_rating ||
        cam?.distortion_character ||
        'Inferred 2D perspective lines',
      shotSize: hasReliableShotSize
        ? rawShotSize
        : 'Uncertain (preserve original source crop & visible body extent)',
      shotSizeConfidence: hasReliableShotSize ? 'high' : 'unknown',
      subjectPlacement: cam?.framing?.subject_position_in_frame || 'Centered in frame',
      subjectScalePct: null,
      summary:
        cam?.camera_position_summary ||
        'Estimated viewpoint inferred from 2D perspective cues (review or adjust if needed).',
    },
    mustNotChange:
      Array.isArray(raw.must_not_change) && raw.must_not_change.length > 0
        ? raw.must_not_change
        : [
            'Subject identity and recognizable facial features',
            'Body proportions, posture, and orientation',
            'Clothing, accessories, materials, and colors',
            'Environment, background elements, lighting, and shadows',
          ],
    occlusionNotes:
      Array.isArray(raw.geometry_risks) && raw.geometry_risks.length > 0
        ? raw.geometry_risks
        : [
            'Surfaces facing away from the original lens are occluded and must be plausibly inferred when orbiting.',
          ],
    userConfirmedEdits: false,
  };
}

/**
 * Calls the existing Whiskai visual-analysis backend (/api/camera-ai/analyze-base).
 * Uses maxRetries: 0 so quota-exhausted or failed requests are never repeatedly retried automatically.
 */
export async function analyzePrimarySourceImage(
  image: ImageDataItem
): Promise<SourceImageAnalysis> {
  const customKey = StorageService.getCustomApiKey();
  const res = await postApiJson<{
    success: boolean;
    analysis: CameraAiBaseAnalysis;
    modelUsed?: string;
    quotaFallback?: boolean;
    fallbackReason?: GeminiFallbackReason;
    quotaCause?: string;
    warning?: string;
  }>(
    '/api/camera-ai/analyze-base',
    {
      image: {
        data: image.data,
        mimeType: image.mimeType,
      },
    },
    { customKey, timeoutMs: 45000, maxRetries: 0 }
  );

  if (!res?.analysis) {
    throw new Error('Visual analysis did not return structured camera estimates.');
  }

  return mapBaseAnalysisToSourceAnalysis(res.analysis, image.name || 'Primary Image', {
    isFallbackEstimate: Boolean(res.quotaFallback),
    warningMessage: res.warning,
    modelUsed: res.modelUsed,
    fallbackReason: res.fallbackReason,
    quotaCause: res.quotaCause,
  });
}
