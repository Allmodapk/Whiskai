import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CATS,
  ADDS,
  BODY_RULES,
  IMAGE_RULES,
  STRICT_LOCK_HEADER,
  STRICT_LOCK_FOOTER,
  LOCK_CATALOG,
} from '../lockCatalog';
import {
  assembleLockPrompt,
  buildLocalDraftDecision,
  detectTouchedCategories,
  evaluateLocalConflicts,
  mergeAndDedupeConflicts,
  sanitizeDecision,
  type Conflict,
  type LockDecision,
} from '../lockAdvisor';

console.log('--- Running Lock Advisor Unit Test Suite ---');

// 1. Catalog parity with lock-list.html (13 categories, 2 add-ons, exact verbatim strings)
{
  assert.equal(CATS.length, 13, 'Catalog must have exactly 13 categories');
  assert.deepEqual(
    CATS.map((c) => c.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    'Category IDs must be 1 through 13 in order'
  );
  assert.equal(ADDS.length, 2, 'Catalog must have exactly 2 add-ons');
  assert.deepEqual(
    ADDS.map((a) => a.id),
    ['A', 'B'],
    'Add-on IDs must be A and B'
  );

  // Verify exact parity with the attached HTML source file if present in workspace
  const htmlPath = path.resolve(
    process.cwd(),
    'public/assets/aistudio/lock-list__1__370da4b0.html'
  );
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const cat of CATS) {
      assert.ok(html.includes(cat.name), `HTML must contain category name "${cat.name}"`);
      for (const item of cat.items) {
        assert.ok(html.includes(item), `HTML must contain verbatim item "${item}"`);
      }
    }
    for (const add of ADDS) {
      assert.ok(html.includes(add.name), `HTML must contain add-on name "${add.name}"`);
      for (const item of add.items) {
        assert.ok(html.includes(item), `HTML must contain verbatim add-on item "${item}"`);
      }
    }
    assert.ok(html.includes('STRICT LOCK INSTRUCTION'));
    assert.ok(html.includes('If an instruction conflicts with a locked element, the locked element wins.'));
    assert.ok(html.includes('BODY PROPORTIONS ARE FIXED:'));
    assert.ok(html.includes('The fit follows the person\'s actual body contours.'));
  }

  assert.ok(STRICT_LOCK_HEADER.startsWith('STRICT LOCK INSTRUCTION\n'));
  assert.ok(
    STRICT_LOCK_FOOTER.endsWith(
      'If an instruction conflicts with a locked element, the locked element wins.'
    )
  );
  assert.ok(BODY_RULES.includes("The new garment's color and pattern are the one exception to the color lock."));
  assert.ok(IMAGE_RULES.startsWith('IMAGE ROLES:\n'));
  console.log('✓ Test 1 passed: Catalog parity with lock-list.html (13 categories, 2 add-ons, verbatim rules)');
}

// 2. Sanitizer rules: strips unknown IDs, fills missing categories as locked, forces [13] released in image mode
{
  const dirty = {
    media: 'image',
    understood_task: 'Modify outfit sleeves.',
    changes: [
      { what: 'Change sleeves', category_ids: [6, 99, -1, 6] },
      { what: '', category_ids: [1] },
    ],
    categories: [
      { id: 99, status: 'released', reason: 'Bogus id' },
      { id: 6, status: 'partial', keep_item_indexes: [3, 99, -2, 3], note: 'Keep fabric', reason: 'Outfit edit' },
      { id: 13, status: 'locked', reason: 'Should be forced released in image mode' },
    ],
    addon_ids: ['A', 'Z', 'B', 'A'],
    change_block: 'Change sleeves to full length.',
    uses_body_rules: true,
    uses_image_roles: true, // must be forced false when hasImage2 is false
    conflicts: [],
    clarifying_question: '   ',
  };

  const sanitized = sanitizeDecision(dirty, {
    media: 'image',
    task: 'Modify outfit sleeves',
    hasImage2: false,
  });

  assert.equal(sanitized.categories.length, 13, 'Sanitizer must always output all 13 categories');
  assert.deepEqual(
    sanitized.categories.map((c) => c.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
  );
  assert.equal(sanitized.categories[0].status, 'locked', 'Missing category [1] defaults to locked');
  assert.equal(sanitized.categories[5].status, 'partial');
  assert.deepEqual(sanitized.categories[5].keep_item_indexes, [3], 'Invalid item indexes stripped');
  assert.equal(sanitized.categories[12].status, 'released', '[13] forced to released in image mode');
  assert.deepEqual(sanitized.addon_ids, ['A', 'B'], 'Unknown add-on ids stripped and deduped');
  assert.equal(sanitized.uses_image_roles, false, 'uses_image_roles forced false without Image 2');
  assert.deepEqual(sanitized.changes, [{ what: 'Change sleeves', category_ids: [6] }]);
  assert.equal(sanitized.clarifying_question, null);

  // Video mode allows [13] locked
  const videoSanitized = sanitizeDecision(dirty, { media: 'video', hasImage2: true });
  assert.equal(videoSanitized.categories[12].status, 'locked', '[13] stays locked in video mode');
  assert.equal(videoSanitized.uses_image_roles, true, 'uses_image_roles allowed when Image 2 supplied');
  console.log('✓ Test 2 passed: Sanitizer strips unknown IDs, fills missing as locked, enforces [13] & Image 2 rules');
}

// 3. Acceptance Case A: "I want to modify current outfit to full sleeve and trousers while keeping rest everything untouched."
{
  const taskA =
    'I want to modify current outfit to full sleeve and trousers while keeping rest everything untouched.';
  const decisionA = buildLocalDraftDecision({
    task: taskA,
    media: 'image',
    pinnedLocks: [],
    hasImage2: false,
  });

  const cat6 = decisionA.categories.find((c) => c.id === 6)!;
  assert.equal(cat6.status, 'partial', '[6] Clothing must be partial');
  assert.deepEqual(cat6.keep_item_indexes, [3], '[6] must keep Footwear (index 3)');
  assert.ok(cat6.note && /color/i.test(cat6.note) && /fabric/i.test(cat6.note) && /pattern/i.test(cat6.note));

  for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) {
    assert.equal(
      decisionA.categories.find((c) => c.id === id)?.status,
      'locked',
      `Category [${id}] must be locked`
    );
  }
  assert.equal(decisionA.categories.find((c) => c.id === 13)?.status, 'released', '[13] must be released');
  assert.deepEqual(decisionA.addon_ids, ['A', 'B'], 'Add-ons A and B must be on');
  assert.equal(decisionA.uses_body_rules, true, 'uses_body_rules must be true');
  assert.equal(decisionA.uses_image_roles, false);
  assert.ok(/full-length sleeves/i.test(decisionA.change_block));
  assert.ok(/full-length trousers/i.test(decisionA.change_block));
  assert.equal(
    decisionA.conflicts.filter((c) => c.severity === 'blocking').length,
    0,
    'No blocking conflicts in Case A'
  );

  const promptA = assembleLockPrompt(decisionA, LOCK_CATALOG, { short: false });
  assert.ok(promptA.startsWith('STRICT LOCK INSTRUCTION\n'));
  assert.ok(promptA.includes('[6] CLOTHING\n- Footwear (if visible)\nException: '));
  assert.ok(!promptA.includes('[13] VIDEO ONLY'), 'Assembled prompt must not list [13]');
  assert.ok(promptA.includes(STRICT_LOCK_FOOTER), 'Lock section must end with locked-wins sentence');
  assert.ok(promptA.includes('CHANGE (the only permitted edit):'));
  assert.ok(promptA.includes(BODY_RULES));
  assert.ok(promptA.includes('ADDITIONAL REQUIREMENTS'));
  assert.ok(promptA.includes('NEWLY EXPOSED AREAS'));
  assert.ok(promptA.includes('BLENDING'));

  // Short mode length check (max ~12 lines)
  const shortA = assembleLockPrompt(decisionA, LOCK_CATALOG, { short: true });
  const shortLines = shortA.split('\n').filter((l) => l.trim().length > 0);
  assert.ok(shortLines.length <= 12, `Short mode should be <= 12 lines (got ${shortLines.length})`);
  assert.ok(shortA.includes('Partial [6] Clothing'));
  assert.ok(shortA.includes('CHANGE (the only permitted edit):'));
  assert.ok(shortA.includes('ADDITIONAL REQUIREMENTS:'));
  console.log(`✓ Test 3 passed: Acceptance Case A (full & short=${shortLines.length} lines)`);
}

// 4. Acceptance Case B: "Change hairstyle to a bun" with [4] pinned locked
{
  const taskB = 'Change hairstyle to a bun';
  const decisionB = buildLocalDraftDecision({
    task: taskB,
    media: 'image',
    pinnedLocks: [4],
    hasImage2: false,
  });

  const cat4 = decisionB.categories.find((c) => c.id === 4)!;
  assert.equal(cat4.status, 'locked', 'Pinned [4] Hair must remain locked');

  const hairConflict = decisionB.conflicts.find((c) => c.category_ids.includes(4));
  assert.ok(hairConflict, 'Must emit warning conflict for pinned [4] Hair');
  assert.equal(hairConflict.severity, 'warning');
  assert.equal(hairConflict.fix.action.type, 'release');
  assert.equal(hairConflict.fix.action.category_id, 4);
  assert.equal(hairConflict.secondary_fix?.action.type, 'lock');

  // Before applying fix, assembled prompt keeps [4] HAIR locked
  const promptBeforeFix = assembleLockPrompt(decisionB, LOCK_CATALOG);
  assert.ok(promptBeforeFix.includes('[4] HAIR\n- Hairstyle and arrangement'));

  // After applying Release fix locally, [4] is no longer listed in locks
  const afterFixDecision: LockDecision = {
    ...decisionB,
    categories: decisionB.categories.map((c) =>
      c.id === 4 ? { id: 4, status: 'released', reason: 'Released via fix.' } : c
    ),
  };
  const promptAfterFix = assembleLockPrompt(afterFixDecision, LOCK_CATALOG);
  assert.ok(!promptAfterFix.includes('[4] HAIR'));
  console.log('✓ Test 4 passed: Acceptance Case B (pinned [4] conflict + Release/Keep fix behavior)');
}

// 5. Every local keyword group detection
{
  const keywordCases: Array<{ task: string; expectedIds: number[]; expectWarningId?: string }> = [
    { task: 'Change shirt and trousers to a jacket', expectedIds: [6] },
    { task: 'Style hair into a ponytail with bangs', expectedIds: [4] },
    { task: 'Replace background scene and props', expectedIds: [8] },
    { task: 'Make lighting warmer sunset with darker shadows', expectedIds: [1, 9] },
    { task: 'Recolor the item to navy blue or red', expectedIds: [1] },
    { task: 'Zoom closer and change crop angle', expectedIds: [10] },
    { task: 'Add gold earrings, glasses, and a watch', expectedIds: [1, 7] },
    { task: 'Make her smile and look at camera', expectedIds: [2] },
    { task: 'Change pose so she sits with hands raised', expectedIds: [5] },
    { task: 'Smooth skin and remove blemish to look younger', expectedIds: [3], expectWarningId: 'local_warn_skin_beauty' },
    { task: 'Make body slimmer and taller', expectedIds: [5], expectWarningId: 'local_warn_body_proportions' },
    { task: 'Adjust lip-sync and camera movement audio', expectedIds: [13] },
  ];

  for (const tc of keywordCases) {
    const det = detectTouchedCategories(tc.task);
    for (const id of tc.expectedIds) {
      assert.ok(
        det.categoryIds.includes(id),
        `Task "${tc.task}" should detect category [${id}] (got [${det.categoryIds.join(', ')}])`
      );
    }
    if (tc.expectWarningId) {
      assert.ok(
        det.specialWarnings.some((w) => w.conflictId === tc.expectWarningId),
        `Task "${tc.task}" should trigger special warning "${tc.expectWarningId}"`
      );
    }
  }

  // Video [13] locked while media is image -> warning
  const allLockedCats = CATS.map((c) => ({
    id: c.id,
    status: 'locked' as const,
    reason: 'Locked',
  }));
  const videoInImageConflicts = evaluateLocalConflicts({
    task: 'Keep framing',
    media: 'image',
    categories: allLockedCats,
  });
  assert.ok(
    videoInImageConflicts.some((c) => c.id === 'local_video_locked_in_image'),
    '[13] ticked in image mode must produce warning'
  );
  console.log('✓ Test 5 passed: All 12 local keyword groups + beauty/body/video warnings');
}

// 6. Conflict deduplication by id + Image 2 IMAGE_RULES assembly
{
  const c1: Conflict = {
    id: 'local_locked_4',
    severity: 'warning',
    category_ids: [4],
    message: 'Local hair conflict',
    fix: { label: 'Release', action: { type: 'release', category_id: 4 } },
  };
  const c1Dup: Conflict = {
    id: 'local_locked_4',
    severity: 'warning',
    category_ids: [4],
    message: 'AI hair conflict',
    fix: { label: 'Release', action: { type: 'release', category_id: 4 } },
  };
  const c2: Conflict = {
    id: 'ai_custom_conflict',
    severity: 'warning',
    category_ids: [1],
    message: 'Color conflict',
    fix: { label: 'Release', action: { type: 'release', category_id: 1 } },
  };

  const merged = mergeAndDedupeConflicts([c1], [c1Dup, c2]);
  assert.equal(merged.length, 2, 'Duplicate conflict ids must be deduped');
  assert.deepEqual(
    merged.map((c) => c.id),
    ['local_locked_4', 'ai_custom_conflict']
  );

  // Image 2 assembly uses IMAGE_RULES instead of BODY_RULES
  const img2Decision = buildLocalDraftDecision({
    task: 'Use the dress from Image 2',
    media: 'image',
    hasImage2: true,
  });
  const img2Prompt = assembleLockPrompt(img2Decision, LOCK_CATALOG);
  assert.ok(img2Prompt.includes('IMAGE ROLES:'), 'Image 2 mode must use IMAGE_RULES');
  assert.ok(img2Prompt.includes('TAKE FROM IMAGE 2 (outfit only):'));
  console.log('✓ Test 6 passed: Conflict deduplication & Image 2 IMAGE_RULES assembly');
}

console.log('All Lock Advisor unit tests passed successfully!');
