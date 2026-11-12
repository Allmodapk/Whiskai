import type {
  CameraDeltaComparison,
  CameraStateSnapshot,
  CameraVariableDelta,
  ContradictionCheckResult,
  ContradictionIssue,
  PreservationPreferences,
  SourceImageAnalysis,
} from './types';

function shortestAzimuthDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function describeFocalCategory(mm: number): string {
  if (mm <= 24) return 'ultra-wide';
  if (mm <= 38) return 'wide';
  if (mm <= 62) return 'normal';
  if (mm <= 95) return 'short telephoto';
  return 'telephoto';
}

export function formatSourceShotSizeLabel(rawShotSize: string): string {
  const trimmed = (rawShotSize || '').trim();
  if (!trimmed) return 'Original Source Shot Size';
  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, string> = {
    ecu: 'Extreme Close-Up (ECU)',
    extreme_closeup: 'Extreme Close-Up (ECU)',
    extreme_close_up: 'Extreme Close-Up (ECU)',
    cu: 'Close-Up (CU)',
    closeup: 'Close-Up (CU)',
    close_up: 'Close-Up (CU)',
    mcu: 'Medium Close-Up (MCU)',
    medium_closeup: 'Medium Close-Up (MCU)',
    medium_close_up: 'Medium Close-Up (MCU)',
    chest_up: 'Chest-Up Medium Close-Up',
    bust_up: 'Chest-Up Medium Close-Up',
    waist_up: 'Waist-Up Medium Shot',
    medium: 'Medium Shot',
    ms: 'Medium Shot',
    three_quarter: 'Three-Quarter Shot',
    three_quarters: 'Three-Quarter Shot',
    cowboy: 'Three-Quarter Shot',
    knee_up: 'Three-Quarter Shot (Knee-Up)',
    full: 'Full-Body Shot',
    full_body: 'Full-Body Shot',
    wide: 'Wide Shot',
    long: 'Wide Shot',
    establishing: 'Wide Environmental Shot',
  };
  return map[normalized] || trimmed;
}

export function compareSourceAndTarget(
  target: CameraStateSnapshot,
  source: SourceImageAnalysis | null,
  preservation?: PreservationPreferences
): CameraDeltaComparison {
  if (!source) {
    const deltas: CameraVariableDelta[] = [
      {
        variable: 'Horizontal Orbit (Azimuth)',
        sourceValue: 'As shown in supplied primary image (unspecified)',
        targetValue: `${target.azimuthDeg}° (${target.azimuthLabel})`,
        changed: true,
        magnitudeLabel: 'Target-defined',
        spatialMeaning: `Reposition the camera horizontally around the fixed subject to ${target.azimuthDeg}° (${target.azimuthLabel}).`,
      },
      {
        variable: 'Camera Elevation & Pitch',
        sourceValue: 'As shown in supplied primary image (unspecified)',
        targetValue: `${target.elevationDeg}° elevation / ${target.pitchDeg}° lens pitch (${target.elevationLabel})`,
        changed: true,
        magnitudeLabel: 'Target-defined',
        spatialMeaning: `Set camera height angle to ${target.elevationDeg}° (${target.elevationLabel}).`,
      },
      {
        variable: 'Distance & Shot Size',
        sourceValue: 'As shown in supplied primary image (unspecified)',
        targetValue: `${target.distanceMeters}m · ${target.shotSize}`,
        changed: true,
        magnitudeLabel: 'Target-defined',
        spatialMeaning: `Frame the subject as a ${target.shotSize} at approximately ${target.distanceMeters}m camera distance.`,
      },
      {
        variable: 'Focal Length & Perspective',
        sourceValue: 'As shown in supplied primary image (unspecified)',
        targetValue: `${target.focalLengthMm}mm eq. (${target.fovDeg}° vFOV · ${target.lensCategoryLabel})`,
        changed: true,
        magnitudeLabel: 'Target-defined',
        spatialMeaning: `Use ${target.focalLengthMm}mm equivalent optical perspective (${target.lensCategoryLabel}).`,
      },
      {
        variable: 'Framing & Roll',
        sourceValue: 'As shown in supplied primary image (unspecified)',
        targetValue: `${target.aspectRatio} · ${target.subjectBounds.placementLabel} · Roll ${target.rollDeg}°`,
        changed: true,
        magnitudeLabel: 'Target-defined',
        spatialMeaning: `Compose subject at ${target.subjectBounds.heightPct}% frame height (${target.subjectBounds.placementLabel}) with ${target.rollDeg}° camera roll.`,
      },
    ];

    const hiddenImplications: string[] = [];
    if (Math.abs(target.azimuthDeg) > 60) {
      hiddenImplications.push(
        `Moving to ${target.azimuthDeg}° (${target.azimuthLabel}) exposes side or rear angles of the subject and room not directly visible from a standard front photo.`
      );
    }
    if (target.elevationDeg >= 30) {
      hiddenImplications.push(
        `Elevated +${target.elevationDeg}° angle reveals top surfaces (crown of head, upper shoulders, floor layout) that may be foreshortened or hidden in eye-level images.`
      );
    } else if (target.elevationDeg <= -15) {
      hiddenImplications.push(
        `Low ${target.elevationDeg}° angle reveals undersides (chin/jawline underside, ceiling/upper background) while foreshortening upper features.`
      );
    }
    if (hiddenImplications.length === 0) {
      hiddenImplications.push(
        'Any background regions newly revealed by shifting the camera viewpoint must extend the original room style seamlessly without inventing unrelated props.'
      );
    }

    return {
      mode: 'camera_first',
      deltas,
      changedVariables: deltas.map((d) => d.variable),
      unchangedVariables: [
        'Subject identity, pose, body orientation, clothing, lighting, and scene environment from the primary image',
      ],
      coupledVisualEffects: [
        'Changing camera azimuth shifts which side of the room appears behind the subject while the subject remains facing its original direction.',
        'Target shot size and focal length work together to control subject scale and background compression.',
      ],
      hiddenDetailImplications: hiddenImplications,
    };
  }

  // Image-aware comparison:
  // Unless requireFullBodyVisibleInOutput is explicitly true, source image controls shot size,
  // crop boundaries, subject scale/placement, and composition while Playboard controls viewpoint & optics.
  const allowFullBodyExpansion = Boolean(preservation?.requireFullBodyVisibleInOutput);
  const srcAz = source.inferredCamera.azimuthDeg.value;
  const srcEl = source.inferredCamera.elevationDeg.value;
  const srcFl = source.inferredCamera.focalLengthMm.value;
  const srcShotRaw = source.inferredCamera.shotSize;
  const srcShotLabel = formatSourceShotSizeLabel(srcShotRaw);
  const srcPlace = source.inferredCamera.subjectPlacement;
  const srcAspectKnown =
    Boolean(source.observable.aspectRatioDetected) &&
    source.observable.aspectRatioDetected.toLowerCase() !== 'unknown';
  const effectiveAspect = srcAspectKnown
    ? source.observable.aspectRatioDetected
    : 'Original source aspect ratio';

  const deltas: CameraVariableDelta[] = [];
  const changedVariables: string[] = [];
  const unchangedVariables: string[] = [];
  const coupledVisualEffects: string[] = [];
  const hiddenDetailImplications: string[] = [];

  // 1. Azimuth
  const azDiff = srcAz !== null ? shortestAzimuthDelta(srcAz, target.azimuthDeg) : null;
  const azChanged = azDiff === null ? true : Math.abs(azDiff) >= 8;
  deltas.push({
    variable: 'Horizontal Orbit (Azimuth)',
    sourceValue:
      srcAz !== null
        ? `~${srcAz}° (${source.inferredCamera.azimuthDeg.confidence} confidence)`
        : 'Uncertain from 2D photo',
    targetValue: `${target.azimuthDeg}° (${target.azimuthLabel})`,
    changed: azChanged,
    magnitudeLabel:
      azDiff !== null
        ? azChanged
          ? `${azDiff >= 0 ? '+' : ''}${Math.round(azDiff)}° orbit shift`
          : 'Preserved (~unchanged)'
        : 'Shifted to target',
    spatialMeaning:
      azDiff !== null && !azChanged
        ? `Maintain approximately the same horizontal viewing direction (~${target.azimuthDeg}°).`
        : `Orbit the camera horizontally ${azDiff !== null ? `${Math.abs(Math.round(azDiff))}° ${azDiff >= 0 ? 'clockwise (toward camera-right)' : 'counter-clockwise (toward camera-left)'}` : ''} around the fixed subject to reach ${target.azimuthDeg}° (${target.azimuthLabel}).`,
  });
  if (azChanged) changedVariables.push('Horizontal Orbit (Azimuth)');
  else unchangedVariables.push('Horizontal Orbit (Azimuth)');

  // 2. Elevation
  const elDiff = srcEl !== null ? target.elevationDeg - srcEl : null;
  const elChanged = elDiff === null ? true : Math.abs(elDiff) >= 7;
  deltas.push({
    variable: 'Camera Elevation & Pitch',
    sourceValue:
      srcEl !== null
        ? `~${srcEl}° (${source.inferredCamera.elevationDeg.confidence} confidence)`
        : 'Uncertain from 2D photo',
    targetValue: `${target.elevationDeg}° (${target.elevationLabel})`,
    changed: elChanged,
    magnitudeLabel:
      elDiff !== null
        ? elChanged
          ? `${elDiff >= 0 ? '+' : ''}${Math.round(elDiff)}° height shift`
          : 'Preserved (~unchanged)'
        : 'Shifted to target',
    spatialMeaning:
      elDiff !== null && !elChanged
        ? `Keep camera elevation near ${target.elevationDeg}° (${target.elevationLabel}).`
        : `${elDiff !== null && elDiff > 0 ? 'Raise' : 'Lower'} the camera vertically to ${target.elevationDeg}° elevation (${target.pitchDeg}° lens pitch — ${target.elevationLabel}).`,
  });
  if (elChanged) changedVariables.push('Camera Elevation & Pitch');
  else unchangedVariables.push('Camera Elevation & Pitch');

  // 3. Shot Size / Distance
  const shotChanged = allowFullBodyExpansion
    ? srcShotLabel.toLowerCase() !== target.shotSize.toLowerCase()
    : false;
  if (allowFullBodyExpansion) {
    deltas.push({
      variable: 'Shot Size & Distance',
      sourceValue: `${srcShotLabel} (${source.inferredCamera.distanceLabel}, ${source.inferredCamera.distanceConfidence} confidence)`,
      targetValue: `${target.shotSize} (${target.distanceMeters}m · full-body requested)`,
      changed: shotChanged,
      magnitudeLabel: shotChanged ? `${srcShotLabel} → ${target.shotSize}` : 'Similar framing scale',
      spatialMeaning: shotChanged
        ? `Explicitly expand framing from ${srcShotLabel} to ${target.shotSize} (~${target.distanceMeters}m distance, subject filling ~${target.subjectBounds.heightPct}% of frame height) as requested.`
        : `Maintain ${target.shotSize} framing (~${target.distanceMeters}m distance).`,
    });
  } else {
    deltas.push({
      variable: 'Shot Size & Framing Extent',
      sourceValue: `${srcShotLabel} (${source.observable.framingDescription})`,
      targetValue: `Preserved ${srcShotLabel} (source-controlled crop)`,
      changed: false,
      magnitudeLabel: `Preserved (${srcShotLabel})`,
      spatialMeaning: `Preserve the primary image's ${srcShotLabel} framing, headroom, and visible body extent (${source.observable.framingDescription}). Use the Playboard camera distance (${target.distanceMeters}m) solely for perspective parallax—do NOT pull back or change shot size.`,
    });
  }
  if (shotChanged) changedVariables.push('Shot Size & Distance');
  else unchangedVariables.push('Shot Size & Framing Extent');

  // 4. Focal Length / Perspective
  const flDiff = srcFl !== null ? target.focalLengthMm - srcFl : null;
  const flChanged = flDiff === null ? true : Math.abs(flDiff) >= 10;
  deltas.push({
    variable: 'Focal Length & Perspective',
    sourceValue:
      srcFl !== null
        ? `~${srcFl}mm (${describeFocalCategory(srcFl)}, ${source.inferredCamera.focalLengthMm.confidence} confidence)`
        : source.inferredCamera.perspectiveCharacter,
    targetValue: `${target.focalLengthMm}mm eq. (${target.lensCategoryLabel})`,
    changed: flChanged,
    magnitudeLabel:
      flDiff !== null && flChanged
        ? `${flDiff > 0 ? 'Narrower/telephoto' : 'Wider'} (${flDiff > 0 ? '+' : ''}${Math.round(flDiff)}mm)`
        : 'Comparable lens perspective',
    spatialMeaning: flChanged
      ? `Render with ${target.focalLengthMm}mm equivalent optics (${target.fovDeg}° vFOV, ${target.lensCategoryLabel}) within the preserved framing.`
      : `Preserve natural ${target.focalLengthMm}mm optical perspective.`,
  });
  if (flChanged) changedVariables.push('Focal Length & Perspective');
  else unchangedVariables.push('Focal Length & Perspective');

  // 5. Roll & Framing Placement
  const rollChanged = Math.abs(target.rollDeg) >= 2;
  if (allowFullBodyExpansion) {
    deltas.push({
      variable: 'Framing Placement & Roll',
      sourceValue: `${source.observable.aspectRatioDetected} · ${srcPlace}`,
      targetValue: `${target.aspectRatio} · ${target.subjectBounds.placementLabel} · Roll ${target.rollDeg}°`,
      changed: rollChanged || srcPlace.toLowerCase() !== target.subjectBounds.placementLabel.toLowerCase(),
      magnitudeLabel: rollChanged ? `Dutch roll ${target.rollDeg}°` : 'Updated frame composition',
      spatialMeaning: `Output ${target.aspectRatio} aspect ratio with subject ${target.subjectBounds.placementLabel.toLowerCase()} and ${target.rollDeg}° camera roll.`,
    });
  } else {
    deltas.push({
      variable: 'Framing Placement & Roll',
      sourceValue: `${source.observable.aspectRatioDetected} · ${srcPlace}`,
      targetValue: `${effectiveAspect} · ${srcPlace} · Roll ${target.rollDeg}°`,
      changed: rollChanged,
      magnitudeLabel: rollChanged
        ? `Dutch roll ${target.rollDeg}° (framing preserved)`
        : 'Preserved source framing & placement',
      spatialMeaning: `Preserve the original ${effectiveAspect} composition, ${srcPlace.toLowerCase()} subject placement, and original crop margins while applying ${target.rollDeg}° camera roll.`,
    });
    if (!rollChanged) {
      unchangedVariables.push('Framing Placement & Aspect Ratio');
    }
  }

  if (azChanged && elChanged) {
    coupledVisualEffects.push(
      'Simultaneous horizontal orbit and vertical elevation shift alters background perspective lines and horizon placement.'
    );
  }
  if (flChanged && shotChanged) {
    coupledVisualEffects.push(
      'Adjusted distance and focal length jointly govern facial foreshortening and background compression.'
    );
  } else if (flChanged && !allowFullBodyExpansion) {
    coupledVisualEffects.push(
      'Adjusted focal length governs facial foreshortening and background depth compression while keeping the original shot size and crop fixed.'
    );
  }
  if (Math.abs(target.azimuthDeg) > 65 || (azDiff !== null && Math.abs(azDiff) > 55)) {
    hiddenDetailImplications.push(
      allowFullBodyExpansion
        ? `Significant horizontal orbit (${target.azimuthDeg}°) reveals side/back regions of the subject and environment that are occluded in the source image.`
        : `Significant horizontal orbit (${target.azimuthDeg}°) reveals side/back regions of the visible subject and adjacent room within the preserved ${srcShotLabel} crop.`
    );
  }
  if (target.elevationDeg >= 25) {
    hiddenDetailImplications.push(
      allowFullBodyExpansion
        ? `High elevation (+${target.elevationDeg}°) exposes the top of the head, shoulder tops, and surrounding floor surface.`
        : `High elevation (+${target.elevationDeg}°) exposes upper surfaces within the preserved ${srcShotLabel} crop (crown of head, shoulder tops, upper background plane) without zooming out to reveal cropped-out lower body parts.`
    );
  }
  if (source.occlusionNotes.length > 0) {
    hiddenDetailImplications.push(...source.occlusionNotes);
  }

  return {
    mode: 'image_aware',
    deltas,
    changedVariables,
    unchangedVariables,
    coupledVisualEffects,
    hiddenDetailImplications,
  };
}

/**
 * Deterministic contradiction & consistency check prior to compiling the final prompt.
 * Never silently resolves conflicts; surfaces clear explanations and suggested resolutions.
 */
export function validateTransformationConsistency(
  target: CameraStateSnapshot,
  prefs: PreservationPreferences,
  source: SourceImageAnalysis | null
): ContradictionCheckResult {
  const issues: ContradictionIssue[] = [];

  const cameraMovedSignificantly =
    !source ||
    Math.abs(target.azimuthDeg - (source.inferredCamera.azimuthDeg.value ?? 0)) >= 8 ||
    Math.abs(target.elevationDeg - (source.inferredCamera.elevationDeg.value ?? 0)) >= 7 ||
    Math.abs(target.rollDeg) >= 3;

  // 1. Pixel-identical composition vs moved camera
  if (prefs.requirePixelIdenticalComposition && cameraMovedSignificantly) {
    issues.push({
      id: 'pixel_identical_vs_camera_move',
      severity: 'error',
      title: 'Contradiction: Pixel-Identical Composition vs. New Camera Perspective',
      explanation: `You locked a new camera viewpoint (${target.azimuthDeg}° azimuth, ${target.elevationDeg}° elevation, ${target.shotSize}), while also requiring the original composition to remain pixel-identical. Moving the camera inherently changes 2D framing and pixel layout.`,
      suggestedResolution:
        'Disable "Require pixel-identical composition" so the scene content stays faithful while the camera viewpoint shifts, or unlock the camera and return to the original viewpoint.',
      resolutionActionId: 'disable_pixel_identical',
    });
  }

  // 2. Close-up shot vs full-body required visible
  const isCloseShot =
    target.shotSize === 'Extreme Close-Up (ECU)' ||
    target.shotSize === 'Close-Up (CU)' ||
    target.shotSize === 'Medium Close-Up (MCU)' ||
    target.shotSize === 'Waist-Up Medium Shot';

  if (prefs.requireFullBodyVisibleInOutput && isCloseShot) {
    issues.push({
      id: 'closeup_vs_full_body',
      severity: 'error',
      title: 'Contradiction: Tight Crop vs. Full-Body Visibility',
      explanation: `Your locked viewport frames a ${target.shotSize} (missing lower body/feet landmarks), but you also required full-body head-to-toe visibility in the output.`,
      suggestedResolution:
        'Disable "Require full-body framing in output" or unlock the frame and dolly the camera back / widen the lens until feet and head fit comfortably.',
      resolutionActionId: 'disable_full_body_lock',
    });
  }

  // 3. Rear / Rear-3/4 view vs front-facing details directly visible
  if (prefs.requireFrontDetailsDirectlyVisible && Math.abs(target.azimuthDeg) >= 115) {
    issues.push({
      id: 'rear_view_vs_front_visible',
      severity: 'error',
      title: 'Contradiction: Rear Camera Angle vs. Front Details Directly Visible',
      explanation: `The locked camera sits behind the subject at ${target.azimuthDeg}° (${target.azimuthLabel}), where facial features and front torso details are physically occluded by the subject's own body.`,
      suggestedResolution:
        'Disable "Require all front-facing details directly visible" (and keep pose frozen so the subject does not turn around), or unlock and orbit back toward the front.',
      resolutionActionId: 'disable_front_visibility_lock',
    });
  }

  // 4. Subject cropped outside viewport warning
  if (
    target.subjectBounds.visibleLandmarks.length === 0 ||
    target.subjectBounds.heightPct < 5
  ) {
    issues.push({
      id: 'subject_out_of_frame',
      severity: 'warning',
      title: 'Subject Partially or Mostly Outside Locked Viewport',
      explanation:
        'Almost none of the reference subject landmarks are currently visible inside the locked camera gate. External image tools may struggle to locate the subject.',
      suggestedResolution:
        'Unlock the frame and re-center the camera target or zoom out slightly so the desired body region stays framed.',
      resolutionActionId: 'unlock_to_adjust',
    });
  }

  // 5. Additional user note mentioning subject rotation vs frozen pose
  if (
    prefs.preservePoseAndOrientation &&
    /\b(turn around|rotate subject|face the camera|look at the new camera)\b/i.test(
      prefs.additionalUserNotes || ''
    )
  ) {
    issues.push({
      id: 'note_vs_pose_freeze',
      severity: 'warning',
      title: 'Possible Confusion: Camera Orbit vs. Subject Rotation',
      explanation:
        'Your custom notes ask the subject to turn or face the camera while "Preserve pose & body orientation" is enabled. In camera-perspective control, the camera moves while the subject stays fixed.',
      suggestedResolution:
        'Clarify whether you want the subject frozen (camera moves around them) or remove the turn instruction from custom notes.',
    });
  }

  return {
    hasErrors: issues.some((i) => i.severity === 'error'),
    hasWarnings: issues.some((i) => i.severity === 'warning'),
    issues,
  };
}
