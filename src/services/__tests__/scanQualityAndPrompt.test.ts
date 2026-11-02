import { checkPromptContradictions } from '../contradictionCheck';
import { findIgnoredSubjectLeaks } from '../leakGuard';
import { buildGeneralExtractorPrompt } from '../promptBuilder';
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

console.log('--- ALL UNIT TESTS PASSED SUCCESSFULLY ---');
