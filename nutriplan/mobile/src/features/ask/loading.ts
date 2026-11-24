/**
 * Loading copy for a pending Ask request. The server decides the real intent, so this is only a hint from the words
 * typed; anything we can't tell gets intent-neutral copy rather than implying a food lookup.
 */
export type PendingKind = 'recipes' | 'plan' | 'log' | 'nutrition' | 'other';

const RECIPE = /\b(recipes?|ideas?|meal prep|something to (make|cook))\b/i;
const PLAN = /^\s*(plan|schedule)\b|\bmeal plan\b|\b(plan|tomorrow|tonight)\b/i;
const LOG = /^\s*(i\s+(had|ate|drank|just)|log|add|track|ate|had)\b/i;
const NUTRITION = /\b(calories|protein|macros|nutrition|carbs|fat|fiber|what (should|could|can) i (eat|have)|what can i (make|cook))\b/i;

export function pendingKind(text: string): PendingKind {
  if (RECIPE.test(text)) return 'recipes';
  // Logging starts the sentence, so check it before planning words that can appear anywhere ("I ate pizza tonight").
  if (LOG.test(text)) return 'log';
  if (PLAN.test(text)) return 'plan';
  if (NUTRITION.test(text)) return 'nutrition';
  return 'other';
}

export function pendingLabel(text: string): string {
  switch (pendingKind(text)) {
    case 'recipes': return 'Looking for recipes…';
    case 'plan': return 'Planning that…';
    case 'log': return 'Finding foods…';
    case 'nutrition': return 'Checking your numbers…';
    default: return 'Looking into that…';
  }
}
