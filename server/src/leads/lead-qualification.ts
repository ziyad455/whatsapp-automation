import { z } from 'zod';
import type { AgentIntent } from '../ai/agent-result';
import type { LeadEvidenceType, LeadIntent } from '../generated/prisma/client';

export const leadQualificationReasonSchema = z.enum([
  'QUALIFIED_COMMITMENT',
  'ACTIVE_LEAD_EVIDENCE',
  'INFORMATION_ONLY',
  'ESCALATION_ONLY',
  'INSUFFICIENT_EVIDENCE',
]);

export type LeadQualificationReason = z.infer<typeof leadQualificationReasonSchema>;

export interface LeadQualificationResult {
  readonly qualifies: boolean;
  readonly intent: LeadIntent;
  readonly reasonCode: LeadQualificationReason;
  readonly evidenceTypes: readonly LeadEvidenceType[];
}

interface LeadQualificationInput {
  readonly message: string;
  readonly detectedIntent: AgentIntent;
  readonly hasActiveLead: boolean;
}

const tokenize = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const containsPhrase = (tokens: readonly string[], phrase: readonly string[]): boolean =>
  tokens.some((_, start) => phrase.every((word, offset) => tokens[start + offset] === word));

const containsAny = (
  tokens: readonly string[],
  phrases: readonly (readonly string[])[],
): boolean => phrases.some(phrase => containsPhrase(tokens, phrase));

const BOOKING_ACTIONS = [
  ['book'], ['reserve'], ['reservation'], ['appointment'],
  ['réserver'], ['reserver'], ['rendez', 'vous'],
  ['حجز'], ['احجز'], ['نحجز'], ['موعد'], ['بغيت', 'نحجز'],
  ['n7jez'], ['nhjez'],
] as const;

const PURCHASE_ACTIONS = [
  ['buy'], ['purchase'], ['order'], ['i', 'need'], ['i', 'want'],
  ['acheter'], ['commander'], ['je', 'veux'], ['j', 'ai', 'besoin'],
  ['أريد'], ['اريد'], ['شراء'], ['اشتري'], ['نحتاج'], ['بغيت'],
  ['bghit'], ['n7taj'], ['nhtaj'],
] as const;

const COMMITMENT_PHRASES = [
  ...BOOKING_ACTIONS,
  ['buy', 'now'], ['purchase', 'now'], ['order', 'now'],
  ['acheter', 'maintenant'], ['commander', 'maintenant'],
  ['الآن'], ['دابا'], ['daba'],
] as const;

const BUDGET_WORDS = new Set([
  'budget', 'mad', 'dhs', 'dh', 'dirham', 'dirhams', 'درهم', 'ميزانية', 'ميزيانية',
]);
const DATE_TIME_WORDS = new Set([
  'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'morning', 'afternoon', 'evening',
  'aujourd', 'hui', 'demain', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',
  'samedi', 'dimanche', 'matin', 'après', 'midi', 'apres', 'soir',
  'اليوم', 'غدا', 'غداً', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة',
  'السبت', 'الأحد', 'صباح', 'مساء', 'غدا', 'lyoum', 'ghdda', 'ghda',
]);
const DURATION_WORDS = new Set([
  'day', 'days', 'night', 'nights', 'hour', 'hours', 'week', 'weeks', 'month', 'months',
  'jour', 'jours', 'nuit', 'nuits', 'heure', 'heures', 'semaine', 'semaines', 'mois',
  'يوم', 'أيام', 'ايام', 'ليلة', 'ليالي', 'ساعة', 'ساعات', 'أسبوع', 'اسبوع', 'شهر',
  'nhar', 'iyam', 'simana',
]);
const GENERIC_ACTION_OBJECTS = new Set([
  'help', 'support', 'information', 'info', 'question', 'aide', 'assistance', 'مساعدة',
  'شي', 'chose', 'thing', 'something', 'it', 'this', 'that', 'cela', 'ça', 'ca',
  'a', 'an', 'the', 'for', 'from', 'starting', 'on', 'at', 'with',
  'un', 'une', 'le', 'la', 'les', 'pour', 'depuis', 'à', 'avec',
  'هاد', 'هذا', 'هذه', 'داك', 'ديك', 'من', 'لمدة',
]);
const PRIOR_REFERENCE_WORDS = new Set([
  'it', 'this', 'that', 'one', 'same', 'cela', 'ça', 'ca', 'celui', 'celle',
  'هذا', 'هذه', 'هاد', 'هادي', 'داك', 'ديك', 'نفس', 'had', 'hadi', 'dak', 'dik',
]);

const hasNumber = (tokens: readonly string[]): boolean => tokens.some(token => /^\d+(?:[.,]\d+)?$/u.test(token));
const hasBudget = (tokens: readonly string[]): boolean =>
  tokens.some(token => BUDGET_WORDS.has(token)) && hasNumber(tokens);
const hasDateOrTime = (tokens: readonly string[]): boolean =>
  tokens.some(token => DATE_TIME_WORDS.has(token)) ||
  tokens.some(token => /^\d{1,2}(?::\d{2})?$/u.test(token));
const hasDuration = (tokens: readonly string[]): boolean =>
  tokens.some((token, index) => DURATION_WORDS.has(token) && index > 0 &&
    (/^\d+$/u.test(tokens[index - 1] ?? '') ||
      ['one', 'two', 'three', 'four', 'five', 'six', 'un', 'deux', 'trois', 'quatre', 'cinq', 'ستة', 'أربعة', 'خمسة'].includes(tokens[index - 1] ?? '')));

const actionObjectIsSpecific = (
  tokens: readonly string[],
  actions: readonly (readonly string[])[],
): boolean => actions.some(action => {
  const start = tokens.findIndex((_, index) => action.every((word, offset) => tokens[index + offset] === word));
  if (start < 0) return false;
  return tokens.slice(start + action.length).some(token =>
    token.length > 2 &&
    !GENERIC_ACTION_OBJECTS.has(token) &&
    !DATE_TIME_WORDS.has(token) &&
    !DURATION_WORDS.has(token) &&
    !BUDGET_WORDS.has(token) &&
    !/^\d/u.test(token));
});

const mapLeadIntent = (intent: AgentIntent): LeadIntent => {
  if (intent === 'BOOKING_INTENT') return 'BOOKING_INTEREST';
  if (intent === 'PURCHASE_INTENT') return 'PURCHASE_INTEREST';
  if (intent === 'COMPLAINT') return 'COMPLAINT';
  if (intent === 'SUPPORT_REQUEST' || intent === 'HUMAN_REQUEST') return 'SUPPORT';
  return 'INFORMATION';
};

export const messageUsesPriorReference = (message: string): boolean =>
  tokenize(message).some(token => PRIOR_REFERENCE_WORDS.has(token));

export const qualifyLeadMessage = (input: LeadQualificationInput): LeadQualificationResult => {
  const tokens = tokenize(input.message);
  const intent = mapLeadIntent(input.detectedIntent);
  const bookingAction = input.detectedIntent === 'BOOKING_INTENT' || containsAny(tokens, BOOKING_ACTIONS);
  const purchaseAction = input.detectedIntent === 'PURCHASE_INTENT' || containsAny(tokens, PURCHASE_ACTIONS);
  const commitment = containsAny(tokens, COMMITMENT_PHRASES) || bookingAction || purchaseAction;
  const budget = hasBudget(tokens);
  const dateOrTime = hasDateOrTime(tokens);
  const duration = hasDuration(tokens);
  const itemOrService = actionObjectIsSpecific(
    tokens,
    bookingAction ? BOOKING_ACTIONS : PURCHASE_ACTIONS,
  );

  if (['COMPLAINT', 'SUPPORT_REQUEST', 'HUMAN_REQUEST', 'OUT_OF_SCOPE'].includes(input.detectedIntent)) {
    return { qualifies: false, intent, reasonCode: 'ESCALATION_ONLY', evidenceTypes: [] };
  }

  const evidenceTypes: LeadEvidenceType[] = [];
  if (purchaseAction) evidenceTypes.push('PURCHASE_INTENT');
  if (bookingAction) evidenceTypes.push('BOOKING_INTENT');
  if (itemOrService) evidenceTypes.push('ITEM_OR_SERVICE');
  if (dateOrTime) evidenceTypes.push('DATE_OR_TIME');
  if (budget) evidenceTypes.push('BUDGET');
  if (duration) evidenceTypes.push('QUANTITY_OR_DURATION');
  if (commitment) evidenceTypes.push('COMMITMENT');

  const commercialIntent = purchaseAction || bookingAction;
  const supportingDetail = itemOrService || dateOrTime || budget || duration;
  const explicitAction = commercialIntent && commitment && supportingDetail;
  const explicitImmediateAction = commercialIntent && containsAny(tokens, [
    ['buy', 'now'], ['purchase', 'now'], ['order', 'now'],
    ['book', 'now'], ['reserve', 'now'], ['acheter', 'maintenant'],
    ['commander', 'maintenant'], ['دابا'], ['الآن'], ['daba'],
  ]);

  if (explicitAction || explicitImmediateAction) {
    return { qualifies: true, intent, reasonCode: 'QUALIFIED_COMMITMENT', evidenceTypes };
  }

  if (input.hasActiveLead && (budget || dateOrTime || duration || itemOrService)) {
    return { qualifies: true, intent, reasonCode: 'ACTIVE_LEAD_EVIDENCE', evidenceTypes };
  }

  const informationOnly = [
    'GENERAL_QUESTION', 'BUSINESS_INFORMATION', 'PRICE_INQUIRY',
    'AVAILABILITY_INQUIRY', 'UNKNOWN',
  ].includes(input.detectedIntent);
  return {
    qualifies: false,
    intent,
    reasonCode: informationOnly ? 'INFORMATION_ONLY' : 'INSUFFICIENT_EVIDENCE',
    evidenceTypes: [],
  };
};
