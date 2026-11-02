import {
  CameraAiTemplateAnalysis,
  CameraAiBaseAnalysis,
  TargetModelType,
} from '../types';
import { exportPromptForModel } from './promptBuilder';

export type CameraAiVariant = 'full' | 'compact' | 'no_base';

/**
 * Validates template & base camera geometry for pitch/horizon contradictions,
 * sign convention errors, or floor/occlusion conflicts.
 */
export function validateCameraAiConsistency(
  template: CameraAiTemplateAnalysis,
  base?: CameraAiBaseAnalysis | null
): string[] {
  const warnings: string[] = [];
  const est = template.estimates;
  const ev = template.evidence;

  // 1. Pitch / Horizon Contradiction: Steep top-down pitch (e.g. <= -70°) with visible horizon
  if (est.pitch_deg <= -70) {
    const horizonTxt = (ev.horizon_visible || '').toLowerCase();
    if (
      horizonTxt.includes('visible in frame') ||
      horizonTxt.includes('middle of frame') ||
      horizonTxt.includes('center of frame') ||
      horizonTxt.includes('y = 50')
    ) {
      warnings.push(
        `Pitch contradiction: Camera pitch is steep top-down (${est.pitch_deg}°), but horizon is reported as visible in middle of frame.`
      );
    }
  }

  // 2. Pitch Label Mismatch
  if (est.pitch_deg <= -60 && est.pitch_label === 'level / eye-level') {
    warnings.push(
      `Pitch label mismatch: Camera pitch is ${est.pitch_deg}°, but label is "${est.pitch_label}".`
    );
  } else if (est.pitch_deg >= 0 && (est.pitch_label === 'top-down' || est.pitch_label === "bird's-eye")) {
    warnings.push(
      `Pitch label mismatch: Camera pitch is ${est.pitch_deg}°, but label is "${est.pitch_label}".`
    );
  }

  // 3. Template vs Base Floor/Environment Conflict
  if (base && est.pitch_deg <= -50) {
    const bg = (base.environment_and_background || '').toLowerCase();
    if (bg.includes('no visible floor') || bg.includes('tight crop on face')) {
      warnings.push(
        'Template camera requires a floor plane from above, but base image has no visible ground plane.'
      );
    }
  }

  // 4. Roll / Azimuth Sign Convention
  if (est.roll_deg < -180 || est.roll_deg > 180) {
    warnings.push(`Roll angle ${est.roll_deg}° exceeds standard range [-180°, +180°].`);
  }
  if (est.azimuth_deg < -180 || est.azimuth_deg > 180) {
    warnings.push(`Azimuth angle ${est.azimuth_deg}° exceeds standard range [-180°, +180°].`);
  }

  return warnings;
}

/**
 * Deterministic prompt assembler for Camera AI.
 * Assembles the 8 blocks in order.
 */
export function assembleCameraAiPrompt(
  template: CameraAiTemplateAnalysis,
  base?: CameraAiBaseAnalysis | null,
  variant: CameraAiVariant = 'full',
  targetModel: TargetModelType = 'universal'
): string {
  const est = template.estimates;

  // Use "no_base" variant if base image analysis is missing
  const activeVariant: CameraAiVariant = base ? variant : 'no_base';

  if (activeVariant === 'compact') {
    // Compact variant (~120 words)
    const baseSubject = base?.subject_type_and_count || 'the subject in the attached image';
    const basePose = base?.pose || 'same pose and weight distribution as the attached image';
    const baseGaze = base?.gaze_direction || 'looking into original Camera B';

    const pitchStr = `${est.pitch_deg}° pitch (${est.pitch_label})`;
    const heightStr = `${est.camera_height} (${est.camera_height_meters}m)`;
    const azimStr = `${est.azimuth_deg}° azimuth (${est.azimuth_reference_axis})`;
    const distStr = `${est.distance_label} (${est.distance_meters}m)`;
    const lensStr = `${est.focal_length_mm}mm ${est.focal_length_label}`;

    let gazeRule = `Subject's body and eyes remain locked onto original Camera B position (${baseGaze}); subject does NOT look up or turn toward new Camera C.`;
    if (est.pitch_deg <= -75) {
      gazeRule += ` Because new Camera C is overhead (${est.pitch_deg}° pitch), subject's eyes stay horizontal pointing to original Camera B, NOT looking up into the overhead lens.`;
    }

    const compactText = `TASK & FROZEN MOMENT LOCK: Re-photograph the attached image of ${baseSubject} from a second, simultaneous camera position (Camera C). Same frozen instant. Subject stays motionless (${basePose}). ${gazeRule}

NEW CAMERA SPEC (CAMERA C): ${est.camera_position_summary} Positioned at ${heightStr}, ${pitchStr}, ${azimStr}, ${distStr}, ${lensStr}, roll ${est.roll_deg}°. Framing: ${est.shot_size}, ${est.framing.aspect_ratio} ${est.framing.orientation}. Depth of field: ${est.depth_of_field.dof_type}.

GEOMETRY & SCENE: ${template.visual_consequences.slice(0, 3).join('. ')}. Same environment, clothing, identity, and lighting as attached image.
NEGATIVES: No pose change, no head turn, no re-styling, no new objects, no changed background.
OUTPUT: ${est.framing.aspect_ratio} ${est.framing.orientation}.`;

    return exportPromptForModel(compactText, targetModel, est.framing.aspect_ratio || '3:4');
  }

  if (activeVariant === 'no_base') {
    // No-base variant: Subject-agnostic phrasing, no invented pose/gaze facts
    const pitchStr = `${est.pitch_deg}° (${est.pitch_label})`;
    const heightStr = `${est.camera_height} (approx. ${est.camera_height_meters}m relative to scene/subject)`;
    const azimStr = `${est.azimuth_deg}° (${est.azimuth_reference_axis})`;
    const distStr = `${est.distance_label} (approx. ${est.distance_meters}m)`;
    const lensStr = `${est.focal_length_mm}mm equivalent (${est.focal_length_label})`;

    let gazeLockRule = `- Subject's body, head, and eyes stay frozen facing the ORIGINAL camera position (Camera B).
- The subject does NOT look at, turn toward, or acknowledge the new camera position.`;
    if (est.pitch_deg <= -75) {
      gazeLockRule += `\n- OVERHEAD GAZE RULE: Because the new camera is steeply overhead (${est.pitch_deg}° pitch), the subject's eyes remain directed horizontally toward original Camera B. Eyes must NOT tilt upward to look into the top-down lens.`;
    }

    const blocks: string[] = [
      `TASK:
Re-photograph the subject and scene from the attached image from a second, simultaneous camera position (Camera C). This is the exact same frozen instant captured by a second camera. Change only the camera viewpoint.`,

      `FROZEN MOMENT LOCK:
- The subject in the attached image does not move, turn, re-pose, or change facial expression.
${gazeLockRule}`,

      `SCENE LOCK:
- Keep the exact same environment, room layout, objects, clothing, subject identity, and lighting direction/quality as in the attached image.
- Only what is naturally revealed by the new camera angle may differ.`,

      `NEW CAMERA SPECIFICATION (CAMERA C):
- World position summary: ${est.camera_position_summary}
- Pitch: ${pitchStr}
- Camera height: ${heightStr}
- Azimuth angle: ${azimStr}
- Distance to subject: ${distStr}
- Lens & focal length: ${lensStr} (${est.distortion_character})
- Roll / Dutch tilt: ${est.roll_deg}°
- Shot size & crop: ${est.shot_size}
- Framing & composition: ${est.framing.orientation} (${est.framing.aspect_ratio}), subject centered at ${est.framing.subject_position_in_frame}, headroom ${est.framing.headroom}
- Depth of field: ${est.depth_of_field.dof_type} (${est.depth_of_field.focus_plane_position})`,

      `GEOMETRY & VISUAL CONSEQUENCES:
${template.visual_consequences.map((c) => `- ${c}`).join('\n')}`,

      `CAMERA B RELATIONSHIP:
- Original Camera B was positioned at eye/chest level directly in front of the subject. The subject's gaze line points straight toward where Camera B was located.`,

      `NEGATIVES (do not include):
No pose change, no head turn toward the new camera, no eye contact with the new lens, no re-styling, no new objects, no changed background, no extra people, no text or watermark.`,

      `OUTPUT FORMAT:
${est.framing.aspect_ratio} ${est.framing.orientation} frame.`,
    ];

    const rawPrompt = blocks.join('\n\n');
    return exportPromptForModel(rawPrompt, targetModel, est.framing.aspect_ratio || '3:4');
  }

  // Full variant (with base image facts)
  const baseObj = base!;
  const pitchStr = `${est.pitch_deg}° (${est.pitch_label})`;
  const heightStr = `${est.camera_height} (approx. ${est.camera_height_meters}m relative to subject/ground)`;
  const azimStr = `${est.azimuth_deg}° relative to subject facing (${est.azimuth_reference_axis})`;
  const distStr = `${est.distance_label} (approx. ${est.distance_meters}m)`;
  const lensStr = `${est.focal_length_mm}mm equivalent (${est.focal_length_label})`;

  let gazeLockRule = `- Subject's body and eyes remain locked facing the ORIGINAL camera (Camera B) exactly as in the attached base image (${baseObj.gaze_direction}).
- The subject does NOT look at, turn toward, or acknowledge new Camera C.`;

  if (est.pitch_deg <= -75) {
    gazeLockRule += `\n- STEEP PITCH GAZE RULE: Because new Camera C is overhead (${est.pitch_deg}° pitch), the subject's eyes stay horizontal pointing toward original Camera B. The subject does NOT tilt their head or eyes upward to look into the overhead camera.`;
  }

  const mustNotChangeList =
    baseObj.must_not_change && baseObj.must_not_change.length > 0
      ? baseObj.must_not_change.map((m) => `- ${m}`).join('\n')
      : `- Subject identity: ${baseObj.subject_type_and_count}
- Pose: ${baseObj.pose}
- Gaze: ${baseObj.gaze_direction}
- Outfit: ${baseObj.clothing_details}
- Environment: ${baseObj.environment_and_background}
- Lighting: ${baseObj.lighting_details}`;

  const blocks: string[] = [
    `TASK:
Re-photograph the attached base image from a second, simultaneous camera position (Camera C). This is the exact same frozen instant photographed by two cameras at once. Camera B (original) stays where it was. New Camera C is added. Change ONLY the camera angle.`,

    `FROZEN MOMENT LOCK:
- Subject (${baseObj.subject_type_and_count}) does not move, turn, re-pose, or change facial expression.
- Exact pose: ${baseObj.pose}.
- Head orientation: ${baseObj.head_orientation}.
${gazeLockRule}`,

    `SCENE & IDENTITY LOCK (MUST NOT CHANGE):
${mustNotChangeList}`,

    `NEW CAMERA SPECIFICATION (CAMERA C):
- World position summary: ${est.camera_position_summary}
- Pitch angle: ${pitchStr}
- Camera height: ${heightStr}
- Azimuth angle: ${azimStr}
- Distance to subject: ${distStr}
- Lens & focal length: ${lensStr} (${est.distortion_character})
- Roll / Dutch tilt: ${est.roll_deg}°
- Shot size: ${est.shot_size}
- Framing: ${est.framing.orientation} (${est.framing.aspect_ratio}), subject positioned at ${est.framing.subject_position_in_frame}, headroom: ${est.framing.headroom}
- Depth of field: ${est.depth_of_field.dof_type} (${est.depth_of_field.focus_plane_position})`,

    `GEOMETRY & VISUAL CONSEQUENCES:
${template.visual_consequences.map((c) => `- ${c}`).join('\n')}`,

    `CAMERA B RELATIONSHIP:
- Original Camera B was positioned at ${baseObj.current_camera.camera_height} (${baseObj.current_camera.pitch_label}).
- The subject's gaze line points directly toward where Camera B was located in space.`,

    `NEGATIVES (do not include):
No pose change, no head turn toward new Camera C, no eye contact with Camera C lens, no re-styling, no new objects, no changed background, no extra people, no text or watermark.`,

    `OUTPUT FORMAT:
${est.framing.aspect_ratio} ${est.framing.orientation} frame.`,
  ];

  const rawPrompt = blocks.join('\n\n');
  return exportPromptForModel(rawPrompt, targetModel, est.framing.aspect_ratio || '3:4');
}

export function buildCameraAiPrompt(
  template: CameraAiTemplateAnalysis,
  base?: CameraAiBaseAnalysis | null,
  options: { variant?: CameraAiVariant; targetModel?: TargetModelType } = {}
): string {
  const variant = options.variant || 'full';
  const targetModel = options.targetModel || 'universal';
  return assembleCameraAiPrompt(template, base, variant, targetModel);
}
