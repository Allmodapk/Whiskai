import assert from 'node:assert/strict';
import {
  SWAP_V1_TEXT,
  SWAP_V2_TEXT,
  SWAP_V3_1_TEXT,
  SWAP_V1_SUB_2_TEXT,
  SWAP_PRESET_TEXT_BY_ID,
  normalizePresetWhitespace,
  SwapPresetId,
} from '../swapPresets';
import {
  PRESET_SWITCHES,
  DEFAULT_SWAP_SWITCHES,
  assembleSwapPrompt,
  getImagesNeeded,
  SwapMatrixSwitches,
} from '../swapBlocks';
import {
  checkSwapConflicts,
  hasBlockingSwapConflict,
} from '../swapConflicts';
import {
  LOCKED_SWAP_PRESETS,
  computeImageHash,
  getRecipeRunTally,
  SwapRunLogEntry,
} from '../swapRecipes';

console.log('Running Swap Studio unit tests...');

// 1. Test Determinism: identical switches and options always return byte-identical output
{
  const customSwitches: SwapMatrixSwitches = {
    body: 'mannequin',
    outfit: 'face',
    expression: 'face',
    background: 'template',
    lighting: 'face',
    ornaments: 'template',
  };
  const run1 = assembleSwapPrompt(customSwitches, { peopleCount: 2, secondPersonSwapped: true });
  const run2 = assembleSwapPrompt(customSwitches, { peopleCount: 2, secondPersonSwapped: true });
  assert.equal(run1, run2, 'assembleSwapPrompt must be 100% deterministic');
}

// 2. Test that locked presets output the exact verbatim preset constants
{
  assert.equal(
    assembleSwapPrompt(PRESET_SWITCHES.swap_v1, { lockedPresetId: 'swap_v1' }),
    SWAP_V1_TEXT,
    'Locked Swap v1 must equal SWAP_V1_TEXT verbatim'
  );
  assert.equal(
    assembleSwapPrompt(PRESET_SWITCHES.swap_v2, { lockedPresetId: 'swap_v2' }),
    SWAP_V2_TEXT,
    'Locked Swap v2 must equal SWAP_V2_TEXT verbatim'
  );
  assert.equal(
    assembleSwapPrompt(PRESET_SWITCHES.swap_v3_1, { lockedPresetId: 'swap_v3_1' }),
    SWAP_V3_1_TEXT,
    'Locked Swap v3.1 must equal SWAP_V3_1_TEXT verbatim'
  );
  assert.equal(
    assembleSwapPrompt(PRESET_SWITCHES.swap_v1_sub_2, { lockedPresetId: 'swap_v1_sub_2' }),
    SWAP_V1_SUB_2_TEXT,
    'Locked Swap v1 Sub 2 must equal SWAP_V1_SUB_2_TEXT verbatim'
  );
}

// 3. Test that block-assembled prompts (without lockedPresetId) match verbatim preset texts
{
  const presetIds: SwapPresetId[] = ['swap_v1', 'swap_v2', 'swap_v3_1', 'swap_v1_sub_2'];
  for (const id of presetIds) {
    const assembled = assembleSwapPrompt(PRESET_SWITCHES[id]);
    const normAssembled = normalizePresetWhitespace(assembled);
    const normVerbatim = normalizePresetWhitespace(SWAP_PRESET_TEXT_BY_ID[id]);
    assert.equal(
      normAssembled,
      normVerbatim,
      `Block-assembled output for ${id} must match verbatim preset text after whitespace normalization`
    );
  }
}

// 4. Test Switch-to-Block Filtering
{
  // 4a. Outfit = 'template' vs Outfit = 'face'
  const promptOutfitTemplate = assembleSwapPrompt({
    ...DEFAULT_SWAP_SWITCHES,
    body: 'mannequin',
    outfit: 'template',
  });
  assert.ok(
    promptOutfitTemplate.includes(
      '- Exact outfit design, color, fabric, pattern, trims and details, refitted to the new body'
    ),
    'Outfit=template must include outfit bullet in KEEP EXACTLY FROM TEMPLATE'
  );
  assert.ok(
    !promptOutfitTemplate.includes("SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):"),
    'Outfit=template must NOT include SUBJECT 1 OUTFIT from FACE block'
  );

  const promptOutfitFace = assembleSwapPrompt({
    ...DEFAULT_SWAP_SWITCHES,
    body: 'mannequin',
    outfit: 'face',
  });
  assert.ok(
    !promptOutfitFace.includes(
      '- Exact outfit design, color, fabric, pattern, trims and details, refitted to the new body'
    ),
    'Outfit=face must remove outfit bullet from KEEP EXACTLY FROM TEMPLATE'
  );
  assert.ok(
    promptOutfitFace.includes("SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):"),
    'Outfit=face must add SUBJECT 1 OUTFIT block'
  );

  // 4b. Body = 'template' vs Body = 'mannequin'
  const promptBodyTemplate = assembleSwapPrompt({
    ...DEFAULT_SWAP_SWITCHES,
    body: 'template',
  });
  assert.ok(
    promptBodyTemplate.includes('HEAD AND BODY MATCH:'),
    'Body=template must include HEAD AND BODY MATCH block'
  );
  assert.ok(
    !promptBodyTemplate.includes('SUBJECT 1 BODY (from MANNEQUIN only, HIGHEST PRIORITY):'),
    'Body=template must NOT include SUBJECT 1 BODY from MANNEQUIN block'
  );

  // 4c. Text Anchors insertion
  const promptWithAnchors = assembleSwapPrompt(
    {
      ...PRESET_SWITCHES.swap_v3_1,
    },
    {
      lockedPresetId: 'swap_v3_1',
      anchors: {
        faceLightingEnabled: true,
        faceLightingText: 'Warm golden key light from camera-left.',
        faceOutfitEnabled: true,
        faceOutfitText: 'Emerald silk blouse with structured collar.',
        mannequinBuildEnabled: true,
        mannequinBuildText: 'Curvy hourglass proportions with 0.7 waist-to-hip ratio.',
      },
    }
  );
  assert.ok(
    promptWithAnchors.includes('- TEXT ANCHOR: Warm golden key light from camera-left.'),
    'Lighting text anchor must be inserted when enabled'
  );
  assert.ok(
    promptWithAnchors.includes('- TEXT ANCHOR: Emerald silk blouse with structured collar.'),
    'Outfit text anchor must be inserted when enabled'
  );
  assert.ok(
    promptWithAnchors.includes(
      '- TEXT ANCHOR: Curvy hourglass proportions with 0.7 waist-to-hip ratio.'
    ),
    'Mannequin build text anchor must be inserted when enabled'
  );
}

// 5. Test Conflict Checker rules (missing required image is the ONLY blocking condition)
{
  // Missing Template and Face -> 2 blocking conflicts
  const missingBoth = checkSwapConflicts({
    switches: DEFAULT_SWAP_SWITCHES,
    hasTemplateImage: false,
    hasFaceImage: false,
    hasMannequinImage: false,
    hasManImage: false,
    peopleCount: 1,
  });
  assert.equal(hasBlockingSwapConflict(missingBoth), true);
  assert.equal(
    missingBoth.filter((c) => c.blocking).length,
    2,
    'Missing Template and Face must both be blocking'
  );

  // Present Template and Face, but trigger all 7 warning conditions -> 0 blocking, all warnings
  const allWarnings = checkSwapConflicts({
    switches: {
      body: 'mannequin',
      outfit: 'face',
      expression: 'face',
      background: 'face_style',
      lighting: 'template',
      ornaments: 'face',
    },
    hasTemplateImage: true,
    hasFaceImage: true,
    hasMannequinImage: false, // Warning 1: Body=Mannequin and no mannequin
    hasManImage: true, // Warning 5: Man uploaded while peopleCount=1
    peopleCount: 1,
    faceShowsOnlyUpperBody: true, // Warning 2: Outfit=Face with upper-body-only Face & empty bottom wear
    typedBottomWearLine: '',
    faceHasClearExpression: false, // Warning 6: Expression=Face without clear expression
  });

  assert.equal(
    hasBlockingSwapConflict(allWarnings),
    false,
    'None of the matrix/image warnings may block Copy when Template and Face are uploaded'
  );
  const warningIds = allWarnings.map((w) => w.id);
  assert.ok(warningIds.includes('body_mannequin_missing_image'));
  assert.ok(warningIds.includes('outfit_face_upper_body_only'));
  assert.ok(warningIds.includes('background_face_lighting_template_mismatch'));
  assert.ok(warningIds.includes('man_uploaded_single_person_template'));
  assert.ok(warningIds.includes('expression_face_unclear'));

  // Warning 4: Body = Template while a mannequin was uploaded
  const unusedMannequin = checkSwapConflicts({
    switches: { ...DEFAULT_SWAP_SWITCHES, body: 'template' },
    hasTemplateImage: true,
    hasFaceImage: true,
    hasMannequinImage: true,
    hasManImage: false,
    peopleCount: 1,
  });
  assert.ok(
    unusedMannequin.some((w) => w.id === 'body_template_with_mannequin_uploaded' && !w.blocking)
  );

  // Warning 7: Saved / Typed switch with empty text
  const emptyTyped = checkSwapConflicts({
    switches: { ...DEFAULT_SWAP_SWITCHES, outfit: 'typed', background: 'saved' },
    hasTemplateImage: true,
    hasFaceImage: true,
    hasMannequinImage: false,
    hasManImage: false,
    peopleCount: 1,
    typedOutfitText: '   ',
    savedBackgroundText: '',
  });
  assert.ok(emptyTyped.some((w) => w.id === 'outfit_typed_empty' && !w.blocking));
  assert.ok(emptyTyped.some((w) => w.id === 'background_saved_empty' && !w.blocking));
}

// 6. Test getImagesNeeded logic
{
  assert.deepEqual(getImagesNeeded({ ...DEFAULT_SWAP_SWITCHES, body: 'template' }, 1, false), [
    'Template',
    'Face',
  ]);
  assert.deepEqual(getImagesNeeded({ ...DEFAULT_SWAP_SWITCHES, body: 'mannequin' }, 1, false), [
    'Template',
    'Face',
    'Mannequin',
  ]);
  assert.deepEqual(getImagesNeeded({ ...DEFAULT_SWAP_SWITCHES, body: 'mannequin' }, 2, true), [
    'Template',
    'Face',
    'Mannequin',
    'Man',
  ]);
  assert.deepEqual(getImagesNeeded({ ...DEFAULT_SWAP_SWITCHES, body: 'template' }, 2, true), [
    'Template',
    'Face',
    'Man',
  ]);
  assert.deepEqual(getImagesNeeded({ ...DEFAULT_SWAP_SWITCHES, body: 'template' }, 2, false), [
    'Template',
    'Face',
  ]);
}

// 7. Test Locked Presets Metadata, Image Hash, and Run Tally
{
  assert.equal(LOCKED_SWAP_PRESETS.length, 4);
  const hashA = computeImageHash('data_sample_alpha_12345');
  const hashB = computeImageHash('data_sample_alpha_12345');
  const hashC = computeImageHash('data_sample_beta_67890');
  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);

  const sampleLogs: SwapRunLogEntry[] = [
    { id: '1', recipeId: 'preset_swap_v1', recipeName: 'Swap v1', tag: 'Worked', timestamp: 1 },
    { id: '2', recipeId: 'preset_swap_v1', recipeName: 'Swap v1', tag: 'Worked', timestamp: 2 },
    { id: '3', recipeId: 'preset_swap_v1', recipeName: 'Swap v1', tag: 'Body drift', timestamp: 3 },
  ];
  const tally = getRecipeRunTally(sampleLogs, 'preset_swap_v1');
  assert.equal(tally.Worked, 2);
  assert.equal(tally['Body drift'], 1);
  assert.equal(tally['Lighting random'], 0);
}

console.log('All Swap Studio unit tests passed!');
