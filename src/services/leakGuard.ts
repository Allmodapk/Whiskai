import { ComponentKey, DetectedComponent, COMPONENT_LABELS } from '../types';

export interface LeakIssue {
  key: ComponentKey;
  label: string;
  text: string;
  matchedTerms: string[];
}

export interface LeakDetectionResult {
  hasLeaks: boolean;
  leaks: LeakIssue[];
}

/**
 * Pure function that checks active components for references to ignored subjects,
 * multi-person plurals, or interaction leaks when operating in Solo Mode.
 */
export function findIgnoredSubjectLeaks(
  components: Partial<Record<ComponentKey, DetectedComponent>>,
  ignoredLabels: string[] = [],
  keptSubjectLabel?: string
): LeakDetectionResult {
  const leaks: LeakIssue[] = [];

  // Terms that signal multi-person or interaction leaks in solo mode
  const multiSubjectTerms = [
    'subject b',
    'subject c',
    'two people',
    'two subjects',
    'the subjects',
    'each other',
    'opposite each other',
    'handshake',
    'together',
    'the couple',
    'second person',
    'another person',
    'other person',
    'man and woman',
    'woman and man',
  ];

  // Specific ignored subject terms from passed labels
  const keptLower = (keptSubjectLabel || '').toLowerCase();
  const isKeptFemale =
    keptLower.includes('woman') ||
    keptLower.includes('female') ||
    keptLower.includes('lady');
  const isKeptMale =
    keptLower.includes('man') ||
    keptLower.includes('male') ||
    keptLower.includes('guy');

  const ignoredTerms: string[] = [];

  for (const label of ignoredLabels) {
    const lLower = label.toLowerCase().trim();
    if (!lLower) continue;
    if (lLower.includes('subject b')) ignoredTerms.push('subject b');
    if (lLower.includes('subject c')) ignoredTerms.push('subject c');

    // If kept subject is female and ignored label mentions man
    if (isKeptFemale && (lLower.includes('man') || lLower.includes('male') || lLower.includes('guy'))) {
      ignoredTerms.push('man', 'the man', 'male');
    }
    // If kept subject is male and ignored label mentions woman
    if (isKeptMale && (lLower.includes('woman') || lLower.includes('female') || lLower.includes('lady'))) {
      ignoredTerms.push('woman', 'the woman', 'female');
    }
  }

  // If kept subject is female and no specific ignored terms were extracted yet, ensure male terms trigger leak
  if (isKeptFemale && ignoredTerms.length === 0) {
    ignoredTerms.push('man', 'the man', 'male');
  } else if (isKeptMale && ignoredTerms.length === 0) {
    ignoredTerms.push('woman', 'the woman', 'female');
  }

  const allTerms = Array.from(new Set([...multiSubjectTerms, ...ignoredTerms]));

  const anatomicalPairs = /\bboth\s+(hands|arms|legs|feet|knees|shoulders|eyes|wrists|ankles|elbows|palms|thighs|heels)\b/i;

  for (const key of Object.keys(components) as ComponentKey[]) {
    const comp = components[key];
    if (!comp) continue;
    if (comp.state === 'ignored' || comp.state === 'unavailable') continue;

    const text = (comp.state === 'edited' ? comp.userText : comp.userText || comp.detectedText || '').trim();
    if (!text) continue;

    const textLower = text.toLowerCase();
    const matchedTerms: string[] = [];

    // Check multi-subject 'both' term (excluding anatomical pairs)
    if (/\bboth\b/i.test(textLower) && !anatomicalPairs.test(textLower)) {
      // Check if 'both' refers to people (e.g. 'both people', 'both subjects', 'both seated', 'both facing')
      if (/\bboth\s+(people|subjects|individuals|persons|seated|standing|facing|looking)\b/i.test(textLower) || /\b(they\s+both|both\s+are)\b/i.test(textLower)) {
        matchedTerms.push('both (multi-subject)');
      }
    }

    for (const term of allTerms) {
      if (
        term === 'other person' &&
        textLower.includes('no other person is present in the frame')
      ) {
        continue;
      }

      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(textLower)) {
        matchedTerms.push(term);
      }
    }

    if (matchedTerms.length > 0) {
      leaks.push({
        key,
        label: COMPONENT_LABELS[key] || key,
        text,
        matchedTerms,
      });
    }
  }

  return {
    hasLeaks: leaks.length > 0,
    leaks,
  };
}
