import { checkPromptContradictions } from '../contradictionCheck';
import { findIgnoredSubjectLeaks } from '../leakGuard';
import { buildGeneralExtractorPrompt } from '../promptBuilder';
import {
  normalizeScanResult,
  mergeRepairedScanResult,
  buildSoloFromMultiSnapshot,
} from '../scanNormalizer';
import { ComponentKey, DetectedComponent, ALL_COMPONENT_KEYS, SubjectData } from '../../types';

function createDummyComponents(
  overrides: Partial<Record<ComponentKey, Partial<DetectedComponent>>> = {}
): Record<ComponentKey, DetectedComponent> {
  const result: any = {};
  for (const key of ALL_COMPONENT_KEYS) {
    result[key] = {
      key,
      label: key,
      detectedText: `Standard description for ${key}.`,
      userText: '',
      state: 'locked',
      source: 'reference',
      explanation: '',
      visibility: 'visible',
      ...(overrides[key] || {}),
    };
  }
  return result;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('--- Running Scan Quality & Prompt Pipeline Unit Tests ---');

// Test 1: Deterministic contradiction check - Full-body framing vs Close-up crop
{
  const comps = createDummyComponents({
    framing: { detectedText: 'Full-body framing showing head to toe.' },
    camera: { detectedText: 'Tight close-up shot cropped at chin level.' },
  });
  const issues = checkPromptContradictions(comps, '3:4', ALL_COMPONENT_KEYS);
  assert(issues.length > 0, 'Expected contradiction between full-body framing and close-up crop');
  assert(
    issues.some((i) => i.id === 'issue_fullbody_vs_crop' || i.id === 'framing_vs_crop'),
    'Expected issue ID issue_fullbody_vs_crop'
  );
  console.log('✓ Test 1 Passed: framing_vs_crop contradiction detected.');
}

// Test 2: Deterministic contradiction check - Seated pose vs Standing
{
  const comps = createDummyComponents({
    pose: { detectedText: 'Subject is seated on a wooden chair with legs crossed.' },
    body: { detectedText: 'Tall athletic standing silhouette.' },
  });
  const issues = checkPromptContradictions(comps, '3:4', ALL_COMPONENT_KEYS);
  assert(
    issues.some((i) => i.id === 'issue_seated_vs_standing' || i.id === 'seated_vs_standing'),
    'Expected seated_vs_standing issue'
  );
  console.log('✓ Test 2 Passed: seated_vs_standing contradiction detected.');
}

// Test 3: Prompt Opener format rule ("Generate a photorealistic image of ...")
{
  const comps = createDummyComponents({
    subject: { detectedText: 'a woman in her late 20s with long brown hair' },
    pose: { detectedText: 'leaning forward on a sofa' },
    environment: { detectedText: 'bright residential living room' },
  });
  const prompt = buildGeneralExtractorPrompt(comps, '3:4', {
    leadSentence: 'a woman in her late 20s with long brown hair, leaning forward on a sofa in a bright residential living room',
    styleCategory: 'photorealistic',
  });
  assert(
    prompt.startsWith('Generate a photorealistic image of'),
    `Expected prompt to start with "Generate a photorealistic image of", got: "${prompt.slice(0, 50)}..."`
  );
  assert(
    !prompt.includes('photorealistic image of a photorealistic'),
    'Expected zero duplication of photorealistic keyword'
  );
  console.log('✓ Test 3 Passed: Prompt opener prefix verified without duplication.');
}

// Test 4: Solo-subject mode line requirement
{
  const comps = createDummyComponents();
  const prompt = buildGeneralExtractorPrompt(comps, '3:4', {
    leadSentence: 'a woman leaning forward on a sofa in a bright living room',
    isSoloMode: true,
  });
  assert(
    prompt.includes('No other person is present in the frame.'),
    'Expected solo mode prompt to contain "No other person is present in the frame."'
  );
  console.log('✓ Test 4 Passed: Solo subject line requirement verified.');
}

// Test 5: Unticked component exclusion
{
  const comps = createDummyComponents({
    clothing: { detectedText: 'Red leather jacket and blue jeans.' },
  });
  const tickedWithoutClothing = ALL_COMPONENT_KEYS.filter((k) => k !== 'clothing');
  const prompt = buildGeneralExtractorPrompt(comps, '3:4', {
    tickedKeys: tickedWithoutClothing,
  });
  assert(!prompt.includes('Red leather jacket'), 'Expected unticked clothing component to be excluded');
  console.log('✓ Test 5 Passed: Unticked component exclusion verified.');
}

// Test 6: Two-person sofa image scenario (woman leaning forward, man seated) with "Keep only A" (woman)
{
  const soloWomanComps = createDummyComponents({
    subject: { detectedText: 'Woman in her late 20s with long brown hair and fair skin.' },
    body: { detectedText: 'Slender natural build.' },
    pose: { detectedText: 'Leaning forward on a beige linen sofa with hands resting on knees.' },
    camera: { detectedText: 'Eye-level camera position at medium portrait distance.' },
    framing: { detectedText: 'Three-quarter framing centered on the woman with open space on the right.' },
    clothing: { detectedText: 'Beige sweatshirt and dark relaxed trousers.' },
    lighting: { detectedText: 'Soft natural window illumination from frame-left.' },
    environment: { detectedText: 'Bright minimalist residential living room setting.' },
    background: { detectedText: 'Cream linen sofa, potted plant, and sheer window curtains.' },
    composition: { detectedText: 'Balanced three-quarter portrait composition with clean framing.' },
    facial_expression: { detectedText: 'Composed neutral expression with steady camera gaze.' },
    hand_gestures: { detectedText: 'Both hands resting lightly on knees.' },
    leg_gestures: { detectedText: 'Seated position with feet flat on hardwood floor.' },
  });

  // Run leak guard
  const leaks = findIgnoredSubjectLeaks(soloWomanComps, ['Subject B', 'man seated on right'], 'Woman');
  assert(!leaks.hasLeaks, `Expected 0 leaks in solo woman components, found: ${JSON.stringify(leaks.leaks)}`);

  // Build final solo prompt
  const prompt = buildGeneralExtractorPrompt(soloWomanComps, '3:4', {
    leadSentence: 'A woman in her late 20s with long brown hair, leaning forward on a sofa in a bright residential living room.',
    isSoloMode: true,
    activeSubjectDecision: 'solo',
  });

  assert(!prompt.includes('Subject B'), 'Prompt must contain zero references to Subject B');
  assert(!/ \bman\b /i.test(prompt), 'Prompt must contain zero references to man');
  assert(!prompt.includes('both people'), 'Prompt must contain zero references to both people');

  // Verify opening sentence names the woman
  assert(
    prompt.startsWith('Generate a photorealistic image of a woman in her late 20s'),
    `Expected prompt to open with woman description, got: "${prompt.slice(0, 75)}..."`
  );

  // Verify "No other person is present in the frame." appears EXACTLY ONCE
  const soloOccurrences = (prompt.match(/No other person is present in the frame\./g) || []).length;
  assert(
    soloOccurrences === 1,
    `Expected "No other person is present in the frame." to appear exactly 1 time, got ${soloOccurrences}`
  );

  // Verify ENVIRONMENT is an independent section
  assert(prompt.includes('ENVIRONMENT:\nBright minimalist residential living room setting.'), 'ENVIRONMENT must be an independent section');

  console.log('✓ Test 6 Passed: Two-person sofa image "Keep only A" verified (zero leaks, opening sentence, exact 1 solo phrase, independent ENVIRONMENT).');
}

// Test 7: Multi-subject "Consider all" mode
{
  const subjects: SubjectData[] = [
    { id: 'A', label: 'Primary woman on sofa', prominence: 'primary' },
    { id: 'B', label: 'Secondary man seated on right', prominence: 'secondary' },
  ];

  const subjectComps: Record<string, Record<ComponentKey, DetectedComponent>> = {
    A: createDummyComponents({
      subject: { detectedText: 'Woman in her late 20s.' },
      clothing: { detectedText: 'Beige sweatshirt.' },
    }),
    B: createDummyComponents({
      subject: { detectedText: 'Man in his early 30s.' },
      clothing: { detectedText: 'Navy blue t-shirt.' },
    }),
  };

  const sharedComps = createDummyComponents({
    interaction: { detectedText: 'The woman and man sit adjacent on the linen sofa.' },
    environment: { detectedText: 'Modern living room setting.' },
  });

  const prompt = buildGeneralExtractorPrompt(sharedComps, '3:4', {
    activeSubjectDecision: 'all',
    subjects,
    subjectComponents: subjectComps,
  });

  assert(prompt.includes('SUBJECT A - SUBJECT:'), 'Expected SUBJECT A section');
  assert(prompt.includes('SUBJECT B - SUBJECT:'), 'Expected SUBJECT B section');
  assert(prompt.includes('SUBJECT INTERACTION:'), 'Expected SUBJECT INTERACTION section');
  console.log('✓ Test 7 Passed: Multi-subject "Consider all" mode sections verified.');
}

// Test 8: Single-person image mode
{
  const singleComps = createDummyComponents({
    subject: { detectedText: 'Man in a black blazer.' },
    environment: { detectedText: 'Sleek executive office.' },
  });

  const prompt = buildGeneralExtractorPrompt(singleComps, '16:9', {
    leadSentence: 'A man in a black blazer in a sleek executive office.',
    isSoloMode: false,
    activeSubjectDecision: 'all',
  });

  assert(!prompt.includes('No other person is present in the frame.'), 'Single-person mode should not include solo sentence');
  assert(prompt.includes('ENVIRONMENT:\nSleek executive office.'), 'ENVIRONMENT section must be present in single-person mode');
  console.log('✓ Test 8 Passed: Single-person image mode verified.');
}

// Test 9: Deduplication of solo phrase
{
  const comps = createDummyComponents();
  const prompt = buildGeneralExtractorPrompt(comps, '3:4', {
    leadSentence: 'A woman in a studio. No other person is present in the frame.',
    isSoloMode: true,
  });

  const occurrences = (prompt.match(/No other person is present in the frame\./g) || []).length;
  assert(occurrences === 1, `Expected solo phrase to be deduped to exactly 1 occurrence, found ${occurrences}`);
  console.log('✓ Test 9 Passed: Solo phrase deduplication verified.');
}

// Test 10: Two-person fixtures across all response shapes produce a populated checklist (13/13 visible)
{
  const subjectsFixture = [
    { id: 'A', label: 'Woman leaning forward on sofa', prominence: 'primary' },
    { id: 'B', label: 'Man seated on frame-right', prominence: 'secondary' },
  ];

  const makeCompObj = (txt: string) => ({
    detectedText: txt,
    explanation: 'Observed in frame',
    visibility: 'visible',
    confidence: 'high',
  });

  // Shape 1: Canonical shape (sharedComponents + personComponents)
  const shape1Canonical = {
    analysis: {
      leadSentence: 'A woman and a man sit on a beige sofa in a living room.',
      subjects: subjectsFixture,
      sharedComponents: {
        camera: makeCompObj('Eye-level medium shot.'),
        framing: makeCompObj('Three-quarter framing of both subjects.'),
        lighting: makeCompObj('Soft window light from frame-left.'),
        background: makeCompObj('Beige sofa and white wall.'),
        environment: makeCompObj('Bright residential living room.'),
        composition: makeCompObj('Balanced two-person composition.'),
        interaction: makeCompObj('Seated side by side on the sofa.'),
      },
      personComponents: {
        A: {
          subject: makeCompObj('Woman in her late 20s with brown hair.'),
          body: makeCompObj('Slender build.'),
          pose: makeCompObj('Leaning forward with hands on knees.'),
          clothing: makeCompObj('Beige crewneck sweatshirt.'),
          facial_expression: makeCompObj('Soft smile looking at lens.'),
          hand_gestures: makeCompObj('Hands resting on knees.'),
          leg_gestures: makeCompObj('Feet flat on floor.'),
        },
        B: {
          subject: makeCompObj('Man in his early 30s with short dark hair.'),
          body: makeCompObj('Athletic build.'),
          pose: makeCompObj('Seated upright against sofa back.'),
          clothing: makeCompObj('Navy t-shirt and grey pants.'),
          facial_expression: makeCompObj('Calm expression looking at camera.'),
          hand_gestures: makeCompObj('Hands folded in lap.'),
          leg_gestures: makeCompObj('Legs relaxed forward.'),
        },
      },
    },
  };

  // Shape 2: Split components (shared in components, per-person in subjectComponents - previous server shape!)
  const shape2Split = {
    analysis: {
      subjects: subjectsFixture,
      components: shape1Canonical.analysis.sharedComponents,
      subjectComponents: shape1Canonical.analysis.personComponents,
    },
  };

  // Shape 3: Old flat shape (all 13 in components)
  const shape3OldFlat = {
    analysis: {
      subjects: subjectsFixture,
      components: {
        ...shape1Canonical.analysis.sharedComponents,
        ...shape1Canonical.analysis.personComponents.A,
      },
    },
  };

  // Shape 4: Key-nested subject map inside components (components.subject.A / B)
  const shape4KeyNested = {
    analysis: {
      subjects: subjectsFixture,
      components: {
        ...shape1Canonical.analysis.sharedComponents,
        subject: {
          A: makeCompObj('Woman in her late 20s.'),
          B: makeCompObj('Man in his early 30s.'),
        },
        body: {
          A: makeCompObj('Slender build.'),
          B: makeCompObj('Athletic build.'),
        },
        pose: {
          A: makeCompObj('Leaning forward.'),
          B: makeCompObj('Seated upright.'),
        },
        clothing: {
          A: makeCompObj('Beige sweatshirt.'),
          B: makeCompObj('Navy t-shirt.'),
        },
        facial_expression: {
          A: makeCompObj('Soft smile.'),
          B: makeCompObj('Calm expression.'),
        },
        hand_gestures: {
          A: makeCompObj('Hands on knees.'),
          B: makeCompObj('Hands in lap.'),
        },
        leg_gestures: {
          A: makeCompObj('Feet on floor.'),
          B: makeCompObj('Legs relaxed.'),
        },
      },
    },
  };

  for (const [idx, fixture] of [shape1Canonical, shape2Split, shape3OldFlat, shape4KeyNested].entries()) {
    const norm = normalizeScanResult(fixture, { mode: 'all' });
    assert(
      norm.visibleCount === 13,
      `Shape ${idx + 1} expected 13/13 visible components, got ${norm.visibleCount}`
    );
    assert(!norm.needsRepair, `Shape ${idx + 1} should not need repair`);
    const unavailableInChecklist = ALL_COMPONENT_KEYS.filter(
      (k) => norm.activeComponents[k].state === 'unavailable'
    );
    assert(
      unavailableInChecklist.length === 0,
      `Shape ${idx + 1} should have 0 unavailable checklist items, got ${unavailableInChecklist.length}`
    );
  }
  console.log('✓ Test 10 Passed: Two-person fixtures in all 4 response shapes produce a populated 13/13 checklist.');
}

// Test 11: Truncated response triggers repair path and merges repaired components cleanly
{
  const truncatedPayload = {
    analysis: {
      subjects: [
        { id: 'A', label: 'Woman on left', prominence: 'primary' },
        { id: 'B', label: 'Man on right', prominence: 'secondary' },
      ],
      sharedComponents: {
        camera: { detectedText: 'Eye-level medium shot.', visibility: 'visible' },
        framing: { detectedText: 'Medium framing.', visibility: 'visible' },
        lighting: { detectedText: 'Natural window light.', visibility: 'visible' },
      },
      personComponents: {
        A: {
          subject: { detectedText: 'Woman in her 20s.', visibility: 'visible' },
          body: { detectedText: 'Slender build.', visibility: 'visible' },
        },
      },
    },
  };

  const initialNorm = normalizeScanResult(truncatedPayload, {
    mode: 'all',
    finishReason: 'MAX_TOKENS',
    jsonRepaired: true,
  });

  assert(initialNorm.needsRepair === true, 'Expected truncated response to trigger needsRepair=true');
  assert(
    initialNorm.missingCoreKeys.includes('background') &&
      initialNorm.missingCoreKeys.includes('environment') &&
      initialNorm.missingCoreKeys.includes('clothing'),
    'Expected missingCoreKeys to list truncated keys'
  );
  // Check exact decision reason for missing keys
  const bgDecision = initialNorm.decisions.find((d) => d.key === 'background');
  assert(
    bgDecision?.reason === 'missing from response',
    `Expected background reason to be "missing from response", got "${bgDecision?.reason}"`
  );

  // Simulate repair payload for the missing keys
  const repairResponse = {
    sharedComponents: {
      background: { detectedText: 'Cream sofa and wall art.', visibility: 'visible' },
      environment: { detectedText: 'Bright modern apartment.', visibility: 'visible' },
      composition: { detectedText: 'Balanced two-subject framing.', visibility: 'visible' },
    },
    personComponents: {
      A: {
        pose: { detectedText: 'Leaning forward.', visibility: 'visible' },
        clothing: { detectedText: 'Beige sweater.', visibility: 'visible' },
        facial_expression: { detectedText: 'Warm smile.', visibility: 'visible' },
        hand_gestures: { detectedText: 'Hands on knees.', visibility: 'visible' },
        leg_gestures: { detectedText: 'Seated with knees bent.', visibility: 'visible' },
      },
      B: {
        subject: { detectedText: 'Man in his 30s.', visibility: 'visible' },
        body: { detectedText: 'Athletic build.', visibility: 'visible' },
        pose: { detectedText: 'Seated upright.', visibility: 'visible' },
        clothing: { detectedText: 'Dark shirt.', visibility: 'visible' },
        facial_expression: { detectedText: 'Neutral expression.', visibility: 'visible' },
        hand_gestures: { detectedText: 'Arms relaxed.', visibility: 'visible' },
        leg_gestures: { detectedText: 'Feet on floor.', visibility: 'visible' },
      },
    },
  };

  const merged = mergeRepairedScanResult(initialNorm, repairResponse, { mode: 'all' });
  assert(merged.visibleCount === 13, `Expected 13/13 visible after repair merge, got ${merged.visibleCount}`);
  assert(!merged.needsRepair, 'Expected needsRepair=false after repair merge');
  console.log('✓ Test 11 Passed: Truncated response triggers repair path and merges missing keys to 13/13.');
}

// Test 12: Simulated empty solo response falls back to stored multi-subject result with needsSoloRewrite flags
{
  const multiFixture = normalizeScanResult(
    {
      analysis: {
        subjects: [
          { id: 'A', label: 'Woman on sofa', prominence: 'primary' },
          { id: 'B', label: 'Man seated on right', prominence: 'secondary' },
        ],
        sharedComponents: {
          camera: { detectedText: 'Eye-level medium shot.', visibility: 'visible' },
          framing: { detectedText: 'Three-quarter framing of both people.', visibility: 'visible' },
          lighting: { detectedText: 'Soft daylight.', visibility: 'visible' },
          background: { detectedText: 'Living room wall behind the subjects.', visibility: 'visible' },
          environment: { detectedText: 'Warm residential living room.', visibility: 'visible' },
          composition: { detectedText: 'Draws the eye toward the man on the right.', visibility: 'visible' },
        },
        personComponents: {
          A: {
            subject: { detectedText: 'Woman in her late 20s.', visibility: 'visible' },
            body: { detectedText: 'Slender build.', visibility: 'visible' },
            pose: { detectedText: 'Seated on the left cushion.', visibility: 'visible' },
            clothing: { detectedText: 'Beige sweatshirt.', visibility: 'visible' },
            facial_expression: { detectedText: 'Calm gaze at camera.', visibility: 'visible' },
            hand_gestures: { detectedText: 'Hands on lap.', visibility: 'visible' },
            leg_gestures: { detectedText: 'Feet flat on rug.', visibility: 'visible' },
          },
          B: {
            subject: { detectedText: 'Man in his 30s.', visibility: 'visible' },
            body: { detectedText: 'Tall build.', visibility: 'visible' },
            pose: { detectedText: 'Leaning back.', visibility: 'visible' },
            clothing: { detectedText: 'Blue shirt.', visibility: 'visible' },
            facial_expression: { detectedText: 'Smiling.', visibility: 'visible' },
            hand_gestures: { detectedText: 'Arms crossed.', visibility: 'visible' },
            leg_gestures: { detectedText: 'Legs crossed.', visibility: 'visible' },
          },
        },
      },
    },
    { mode: 'all' }
  );

  // Simulate empty solo response from /api/reanalyze-solo
  const emptySoloNorm = normalizeScanResult({ analysis: {} }, { mode: 'solo', keepIds: ['A'] });
  assert(emptySoloNorm.visibleCount === 0, 'Expected empty solo response to have 0 visible components');

  // Fallback to stored multi-subject snapshot for Subject A
  const soloFallback = buildSoloFromMultiSnapshot(multiFixture, 'A');
  assert(
    soloFallback.canonical.visibleCount === 13,
    `Expected fallback solo view to preserve all 13 visible components, got ${soloFallback.canonical.visibleCount}`
  );
  assert(
    soloFallback.canonical.activeComponents.subject.detectedText === 'Woman in her late 20s.',
    'Expected Subject A person component to be preserved'
  );
  assert(
    !soloFallback.canonical.activeComponents.subject.detectedText.includes('Man in his 30s'),
    'Expected Subject B person component to be excluded'
  );
  assert(
    soloFallback.canonical.activeComponents.framing.needsSoloRewrite === true &&
      soloFallback.canonical.activeComponents.composition.needsSoloRewrite === true,
    'Expected plural/ignored-subject scene fields to be flagged with needsSoloRewrite=true'
  );
  console.log('✓ Test 12 Passed: Empty solo response falls back to stored multi-subject result with 13/13 components and needsSoloRewrite flags.');
}

// Test 13: Single-person path is unchanged and normalizes 13/13 components
{
  const singleFixture = {
    analysis: {
      leadSentence: 'A woman sits on a wooden bed frame in a sunlit bedroom.',
      styleCategory: 'photorealistic',
      subjects: [{ id: 'A', label: 'Woman on bed', prominence: 'primary' }],
      components: createDummyComponents(),
    },
  };

  const singleNorm = normalizeScanResult(singleFixture, { mode: 'all' });
  assert(singleNorm.subjects.length === 1, 'Expected 1 subject in single-person path');
  assert(singleNorm.visibleCount === 13, 'Expected 13/13 visible components in single-person path');
  assert(!singleNorm.needsRepair, 'Single-person complete response should not trigger repair');
  console.log('✓ Test 13 Passed: Single-person path is unchanged (13/13 visible).');
}

console.log('--- ALL UNIT TESTS PASSED SUCCESSFULLY ---');

