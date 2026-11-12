import type { TargetModelType } from '../../types';
import { exportPromptForModel } from '../promptBuilder';
import { compareSourceAndTarget } from './comparisonAndValidation';
import type {
  CompiledPerspectivePrompt,
  LockedCameraFrame,
  PreservationPreferences,
  SourceImageAnalysis,
} from './types';

function describeOrbitSpatialMotion(azimuthDeg: number): string {
  const abs = Math.abs(azimuthDeg);
  if (abs <= 8) return 'directly in front of the subject along their facing axis';
  if (abs >= 170) return 'directly behind the subject (180° rear axis)';
  const side =
    azimuthDeg > 0
      ? "to the camera-right / subject's left side"
      : "to the camera-left / subject's right side";
  return `${Math.round(abs)}° around the subject ${side}`;
}

function describeElevationSpatialMeaning(elevationDeg: number, pitchDeg: number): string {
  if (elevationDeg >= 65) {
    return `positioned steeply overhead (+${elevationDeg}° elevation, lens pitched ${pitchDeg}° downward), looking nearly straight down onto the crown of the head, shoulders, and floor plane`;
  }
  if (elevationDeg >= 25) {
    return `raised to a clear high-angle position (+${elevationDeg}° elevation, lens pitched ${pitchDeg}° downward), looking down across the subject toward the ground`;
  }
  if (elevationDeg >= 8) {
    return `slightly elevated (+${elevationDeg}° elevation, lens pitched ${pitchDeg}° downward) for a subtle downward perspective`;
  }
  if (elevationDeg > -8) {
    return `at horizontal eye/target level (${elevationDeg}° elevation, ${pitchDeg}° pitch) with natural upright verticals`;
  }
  if (elevationDeg > -28) {
    return `lowered to a subtle low-angle position (${elevationDeg}° elevation, lens pitched +${Math.abs(pitchDeg)}° upward)`;
  }
  return `positioned low near the ground (${elevationDeg}° elevation, lens pitched +${Math.abs(pitchDeg)}° upward), looking boldly up toward the subject`;
}

function describeRollVisualMeaning(rollDeg: number): string {
  if (Math.abs(rollDeg) < 1) return 'level horizon (0° roll / zero Dutch tilt)';
  const dir = rollDeg > 0 ? 'clockwise' : 'counter-clockwise';
  return `${Math.abs(rollDeg)}° ${dir} Dutch tilt (${rollDeg}° roll around the optical axis)`;
}

/**
 * Pure deterministic Prompt Design Engine.
 * Consumes ONLY the LockedCameraFrame (captured from the actual Three.js camera state),
 * optional SourceImageAnalysis, and PreservationPreferences.
 * Generates the exact 9-section image-to-image transformation prompt.
 */
export function compilePerspectivePrompt(params: {
  lockedFrame: LockedCameraFrame;
  sourceAnalysis: SourceImageAnalysis | null;
  preservation: PreservationPreferences;
  targetModel: TargetModelType;
}): CompiledPerspectivePrompt {
  const { lockedFrame, sourceAnalysis, preservation, targetModel } = params;
  const cam = lockedFrame.cameraState;
  const mode = sourceAnalysis ? 'image_aware' : 'camera_first';
  const comparison = compareSourceAndTarget(cam, sourceAnalysis);

  // 1. TASK OBJECTIVE
  const taskObjective =
    mode === 'image_aware'
      ? `Re-photograph the attached primary image as an exact same-instant, controlled camera-perspective transformation. Treat the primary image as the absolute source of truth for the subject, pose, wardrobe, lighting, and environment—move ONLY the virtual camera to the target perspective (${cam.azimuthLabel}, ${cam.elevationLabel}, ${cam.shotSize}) without redesigning the scene or rotating the subject.`
      : `Re-photograph the attached primary image from a new target camera perspective (${cam.azimuthLabel}, ${cam.elevationLabel}, ${cam.shotSize}). Treat the supplied primary image as the absolute visual source of truth—preserve the scene and frozen moment while relocating ONLY the camera to the specified target viewpoint.`;

  // 2. SOURCE IMAGE UNDERSTANDING
  const sourceImageUnderstanding = sourceAnalysis
    ? [
        `Directly observable visual facts from the primary image ("${sourceAnalysis.imageName}"):`,
        `- Subject: ${sourceAnalysis.observable.subjectDescription}`,
        `- Body pose & world orientation: ${sourceAnalysis.observable.poseAndOrientation}`,
        `- Head orientation & gaze: ${sourceAnalysis.observable.headAndGaze}`,
        `- Clothing & accessories: ${sourceAnalysis.observable.clothingAndAccessories}`,
        `- Environment & background: ${sourceAnalysis.observable.environmentAndBackground}`,
        `- Lighting & shadows: ${sourceAnalysis.observable.lightingAndShadows}`,
        `- Original image framing: ${sourceAnalysis.observable.aspectRatioDetected} (${sourceAnalysis.observable.framingDescription})`,
      ].join('\n')
    : `No pre-scan analysis was attached inside Whiskai (Camera-First Mode). Inspect the attached primary image directly to read the subject's identity, exact frozen pose, body orientation, gaze direction, wardrobe, lighting direction, and surrounding environment before applying the camera transformation below.`;

  // 3. ORIGINAL CAMERA PERSPECTIVE
  let originalCameraPerspective: string;
  if (sourceAnalysis) {
    const inf = sourceAnalysis.inferredCamera;
    const azText =
      inf.azimuthDeg.value !== null
        ? `approximately ${inf.azimuthDeg.value}° (${inf.azimuthDeg.confidence} confidence${inf.azimuthDeg.rangeMin !== null && inf.azimuthDeg.rangeMax !== null ? `, plausible range ${inf.azimuthDeg.rangeMin}° to ${inf.azimuthDeg.rangeMax}°` : ''})`
        : `uncertain (${inf.azimuthDeg.confidence} confidence)`;
    const elText =
      inf.elevationDeg.value !== null
        ? `approximately ${inf.elevationDeg.value}° elevation (${inf.elevationDeg.confidence} confidence${inf.elevationDeg.rangeMin !== null && inf.elevationDeg.rangeMax !== null ? `, range ${inf.elevationDeg.rangeMin}° to ${inf.elevationDeg.rangeMax}°` : ''})`
        : `uncertain (${inf.elevationDeg.confidence} confidence)`;
    const flText =
      inf.focalLengthMm.value !== null
        ? `roughly ${inf.focalLengthMm.value}mm equivalent (${inf.focalLengthMm.confidence} confidence)`
        : `${inf.perspectiveCharacter} (${inf.focalLengthMm.confidence} confidence)`;

    originalCameraPerspective = [
      `Estimated starting viewpoint inferred from 2D visual cues (these are approximate estimates, not physical measurements):`,
      `- Original azimuth: ${azText}`,
      `- Original elevation: ${elText}`,
      `- Approximate distance & shot size: ${inf.shotSize} at ${inf.distanceLabel} distance (${inf.distanceConfidence} confidence)`,
      `- Lens / perspective character: ${flText}`,
      `- Source subject placement: ${inf.subjectPlacement}`,
      `- Summary: ${inf.summary}`,
    ].join('\n');
  } else {
    originalCameraPerspective = `Do not assume fixed source camera coordinates. First inspect the attached primary image to establish its actual starting camera viewpoint, horizon height, shot size, and lens perspective, then transform smoothly from that observed starting camera toward the exact target perspective below.`;
  }

  // 4. TARGET CAMERA PERSPECTIVE
  const visiblePartsText =
    cam.subjectBounds.visibleLandmarks.length > 0
      ? cam.subjectBounds.visibleLandmarks.join(', ')
      : 'subject center';
  const croppedNote =
    cam.subjectBounds.croppedEdges.length > 0
      ? `Natural frame crop edges: ${cam.subjectBounds.croppedEdges.join(', ')}.`
      : 'Entire target composition sits cleanly inside the frame borders.';

  const targetCameraPerspective = [
    `Locked 3D Playboard Target Configuration (captured at ${new Date(lockedFrame.lockedAt).toISOString()}):`,
    `- Viewing direction (Azimuth): ${cam.azimuthLabel} at ${cam.azimuthDeg}° — camera sits ${describeOrbitSpatialMotion(cam.azimuthDeg)}.`,
    `- Camera height & tilt (Elevation / Pitch): ${cam.elevationLabel} — camera is ${describeElevationSpatialMeaning(cam.elevationDeg, cam.pitchDeg)}.`,
    `- Camera-to-target distance: ${cam.distanceMeters}m from look-at target (${cam.targetPosition.x}m, ${cam.targetPosition.y}m, ${cam.targetPosition.z}m); camera world coordinates (${cam.worldPosition.x}m, ${cam.worldPosition.y}m, ${cam.worldPosition.z}m) with subject anchored at origin (0, 0, 0) facing +Z.`,
    `- Shot size & scale: ${cam.shotSize} — subject spans ~${cam.subjectBounds.heightPct}% of frame height (${cam.subjectBounds.widthPct}% width); key body landmarks in frame: ${visiblePartsText}.`,
    `- Frame placement & aspect ratio: ${cam.aspectRatio} aspect ratio (${cam.viewportDimensions.width}×${cam.viewportDimensions.height} viewport), subject ${cam.subjectBounds.placementLabel.toLowerCase()} (normalized center x=${cam.subjectBounds.centerNdcX}, y=${cam.subjectBounds.centerNdcY}). ${croppedNote}`,
    `- Optical lens & projection: ${cam.focalLengthMm}mm full-frame equivalent (${cam.fovDeg}° vertical FOV, ${cam.lensCategoryLabel}, ${cam.projectionType} projection).`,
    `- Camera roll: ${describeRollVisualMeaning(cam.rollDeg)}.`,
  ].join('\n');

  // 5. REQUIRED CAMERA TRANSFORMATION
  const transformLines = comparison.deltas.map(
    (d) => `- ${d.variable} [${d.magnitudeLabel}]: ${d.spatialMeaning}`
  );
  if (comparison.coupledVisualEffects.length > 0) {
    transformLines.push(
      ...comparison.coupledVisualEffects.map((e) => `- Spatial perspective coupling: ${e}`)
    );
  }
  const requiredCameraTransformation = [
    `Execute the following camera relocation around the stationary subject:`,
    ...transformLines,
    `- CRITICAL SEPARATION: Move ONLY the camera in 3D space. The subject MUST NOT turn their body, rotate their feet, turn their head, or alter their posture to follow or face the new camera.`,
  ].join('\n');

  // 6. ELEMENTS THAT MUST REMAIN UNCHANGED
  const preservedList: string[] = [];
  if (preservation.preserveIdentityAndFace) {
    preservedList.push('Subject facial identity, bone structure, skin tone, and recognizable likeness');
  }
  if (preservation.preserveHairAndFeatures) {
    preservedList.push('Hairstyle, hair length/texture, facial hair, scars, moles, or distinctive marks');
  }
  if (preservation.preserveClothingAndAccessories) {
    preservedList.push('Exact clothing garments, fit, folds, footwear, and worn accessories');
  }
  if (preservation.preserveBodyProportions) {
    preservedList.push('Body build, limb proportions, height, and natural silhouette');
  }
  if (preservation.preservePoseAndOrientation) {
    preservedList.push(
      'Frozen world-space pose, limb arrangement, hand/finger posture, and original body facing direction'
    );
  }
  if (preservation.preserveExpression) {
    preservedList.push('Original facial expression and original eye gaze target (do not redirect eyes toward the moved camera)');
  }
  if (preservation.preserveEnvironmentAndLighting) {
    preservedList.push(
      'Original room/environment architecture, props, light source direction, color temperature, and shadow placement'
    );
  }
  if (preservation.preserveColorsAndTextures) {
    preservedList.push('Material finishes, fabric weaves, surface textures, and color palette');
  }
  if (preservation.additionalUserNotes.trim()) {
    preservedList.push(`User instruction note: ${preservation.additionalUserNotes.trim()}`);
  }

  const elementsUnchanged =
    preservedList.length > 0
      ? preservedList.map((item) => `- ${item}`).join('\n')
      : '- Preserve core subject identity and scene continuity where compatible with the requested camera change.';

  // 7. VISUAL CONSISTENCY REQUIREMENTS
  const visualConsistencyRequirements = [
    `- Keep the primary image as the visual ground truth; this is a re-shot photograph from a simultaneous camera, never a stylized redesign.`,
    `- Maintain coherent 3D perspective geometry across floor planes, walls, and subject foreshortening matching a ${cam.focalLengthMm}mm lens at ${cam.elevationDeg}° elevation.`,
    `- Keep light direction and cast shadow angles locked to the original environment world space—only their apparent screen-space angle changes as the camera orbits to ${cam.azimuthDeg}°.`,
    `- Keep depth of field, photographic grain, and natural texture sharpness consistent with the primary photograph.`,
  ].join('\n');

  // 8. HANDLING OF PREVIOUSLY HIDDEN OR UNSEEN DETAILS
  const hiddenLines = [
    ...comparison.hiddenDetailImplications.map((h) => `- ${h}`),
    `- When the camera angle reveals surfaces occluded in the primary image (e.g., side profile, rear clothing/hair, back walls, or floor beneath the subject), synthesize only plausible continuations of the existing garments, body anatomy, and room design without inventing unrequested props or altering visible design motifs.`,
  ];
  const hiddenOrUnseenDetails = hiddenLines.join('\n');

  // 9. FINAL OUTPUT REQUIREMENTS
  const finalOutputRequirements = [
    `- Output a single, clean ${cam.aspectRatio} photograph framed as a ${cam.shotSize} from the locked target camera (${cam.azimuthDeg}° azimuth, ${cam.elevationDeg}° elevation, ${cam.distanceMeters}m distance, ${cam.focalLengthMm}mm lens, ${cam.rollDeg}° roll).`,
    `- Ensure zero extra people, zero duplicated limbs, zero scene restyling, and zero UI overlays or borders.`,
  ].join('\n');

  const sections = {
    taskObjective,
    sourceImageUnderstanding,
    originalCameraPerspective,
    targetCameraPerspective,
    requiredCameraTransformation,
    elementsUnchanged,
    visualConsistencyRequirements,
    hiddenOrUnseenDetails,
    finalOutputRequirements,
  };

  const fullText = [
    `1. TASK OBJECTIVE\n${sections.taskObjective}`,
    `2. SOURCE IMAGE UNDERSTANDING\n${sections.sourceImageUnderstanding}`,
    `3. ORIGINAL CAMERA PERSPECTIVE\n${sections.originalCameraPerspective}`,
    `4. TARGET CAMERA PERSPECTIVE\n${sections.targetCameraPerspective}`,
    `5. REQUIRED CAMERA TRANSFORMATION\n${sections.requiredCameraTransformation}`,
    `6. ELEMENTS THAT MUST REMAIN UNCHANGED\n${sections.elementsUnchanged}`,
    `7. VISUAL CONSISTENCY REQUIREMENTS\n${sections.visualConsistencyRequirements}`,
    `8. HANDLING OF PREVIOUSLY HIDDEN OR UNSEEN DETAILS\n${sections.hiddenOrUnseenDetails}`,
    `9. FINAL OUTPUT REQUIREMENTS\n${sections.finalOutputRequirements}`,
  ].join('\n\n');

  const exportedText = exportPromptForModel(fullText, targetModel, cam.aspectRatio);

  return {
    mode,
    targetModel,
    lockedAt: lockedFrame.lockedAt,
    sections,
    fullText,
    exportedText,
    comparison,
  };
}
