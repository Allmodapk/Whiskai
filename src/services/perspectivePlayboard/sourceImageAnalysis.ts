import type { CameraAiBaseAnalysis, ImageDataItem } from '../../types';
import { postApiJson } from '../apiClient';
import { StorageService } from '../storage';
import type { ConfidenceLevel, SourceImageAnalysis } from './types';

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

/**
 * Maps raw /api/camera-ai/analyze-base response into an honest SourceImageAnalysis
 * distinguishing directly observable image properties from uncertain inferred 3D estimates.
 */
export function mapBaseAnalysisToSourceAnalysis(
  raw: CameraAiBaseAnalysis,
  imageName: string,
  options: { isFallbackEstimate?: boolean; warningMessage?: string } = {}
): SourceImageAnalysis {
  const cam = raw.current_camera;
  const isFallback = Boolean(options.isFallbackEstimate);

  const azVal = clampNumeric(cam?.azimuth_deg, -180, 180);
  const azMin = clampNumeric(cam?.azimuth_range?.[0], -180, 180);
  const azMax = clampNumeric(cam?.azimuth_range?.[1], -180, 180);

  // Server pitch_deg: negative = looking down (camera elevated). Our elevationDeg = -pitch_deg.
  const rawPitch = typeof cam?.pitch_deg === 'number' ? cam.pitch_deg : 0;
  const elVal = clampNumeric(-rawPitch, -65, 85);
  const elRange0 =
    typeof cam?.pitch_range?.[1] === 'number' ? clampNumeric(-cam.pitch_range[1], -65, 85) : null;
  const elRange1 =
    typeof cam?.pitch_range?.[0] === 'number' ? clampNumeric(-cam.pitch_range[0], -65, 85) : null;

  const flVal = clampNumeric(cam?.focal_length_mm, 14, 200);
  const flMin = clampNumeric(cam?.focal_length_range?.[0], 14, 200);
  const flMax = clampNumeric(cam?.focal_length_range?.[1], 14, 200);

  const downgrade = (lvl: ConfidenceLevel): ConfidenceLevel =>
    isFallback ? 'low' : lvl;

  return {
    analyzedAt: Date.now(),
    imageName,
    isFallbackEstimate: isFallback,
    warningMessage: options.warningMessage,
    observable: {
      subjectDescription: raw.subject_type_and_count || 'Subject visible in uploaded image',
      poseAndOrientation: raw.pose || 'Observable posture in source frame',
      headAndGaze: `${raw.head_orientation || 'Head angle visible'}; ${raw.gaze_direction || 'gaze direction visible'}`,
      expressionAndFeatures: 'Preserve facial identity, hairstyle, skin texture, and expression as shown in source photo',
      clothingAndAccessories: raw.clothing_details || 'Wardrobe details visible in source frame',
      environmentAndBackground: raw.environment_and_background || 'Scene environment visible in source frame',
      lightingAndShadows: raw.lighting_details || 'Lighting direction and shadow contrast visible in source frame',
      aspectRatioDetected: cam?.framing?.aspect_ratio || 'Unknown',
      framingDescription: [
        cam?.framing?.subject_position_in_frame,
        cam?.framing?.headroom,
        cam?.framing?.crop_behavior,
      ]
        .filter(Boolean)
        .join(' · ') || 'Framing observed directly in uploaded image',
    },
    inferredCamera: {
      azimuthDeg: {
        value: azVal,
        rangeMin: azMin,
        rangeMax: azMax,
        confidence: downgrade(scoreToConfidence(cam?.azimuth_confidence)),
        note: cam?.azimuth_reference_axis || 'Estimated horizontal angle relative to subject facing direction',
      },
      elevationDeg: {
        value: elVal,
        rangeMin: elRange0 !== null && elRange1 !== null ? Math.min(elRange0, elRange1) : null,
        rangeMax: elRange0 !== null && elRange1 !== null ? Math.max(elRange0, elRange1) : null,
        confidence: downgrade(scoreToConfidence(cam?.pitch_confidence)),
        note: `${cam?.camera_height || 'Inferred camera height'} (${cam?.pitch_label || 'estimated tilt'})`,
      },
      distanceLabel: cam?.distance_label || 'medium',
      distanceConfidence: downgrade(scoreToConfidence(cam?.distance_confidence)),
      focalLengthMm: {
        value: flVal,
        rangeMin: flMin,
        rangeMax: flMax,
        confidence: downgrade(scoreToConfidence(cam?.focal_length_confidence)),
        note: `${cam?.focal_length_label || 'estimated lens'} · ${cam?.distortion_character || 'inferred perspective compression'}`,
      },
      perspectiveCharacter:
        cam?.perspective_strength_rating || cam?.distortion_character || 'Inferred 2D perspective lines',
      shotSize: cam?.shot_size || 'medium',
      shotSizeConfidence: isFallback ? 'medium' : 'high',
      subjectPlacement: cam?.framing?.subject_position_in_frame || 'Centered in frame',
      subjectScalePct: null, // Single 2D photo scale % is optional/editable by user rather than fabricated
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
        : ['Surfaces facing away from the original lens are occluded and must be plausibly inferred when orbiting.'],
    userConfirmedEdits: false,
  };
}

/**
 * Calls the existing Whiskai visual-analysis backend (/api/camera-ai/analyze-base)
 * to inspect the optional primary image without touching any backend code.
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
    warning?: string;
  }>(
    '/api/camera-ai/analyze-base',
    {
      image: {
        data: image.data,
        mimeType: image.mimeType,
      },
    },
    { customKey, timeoutMs: 45000, maxRetries: 1 }
  );

  if (!res?.analysis) {
    throw new Error('Visual analysis did not return structured camera estimates.');
  }

  return mapBaseAnalysisToSourceAnalysis(res.analysis, image.name || 'Primary Image', {
    isFallbackEstimate: Boolean(res.quotaFallback),
    warningMessage: res.warning,
  });
}
