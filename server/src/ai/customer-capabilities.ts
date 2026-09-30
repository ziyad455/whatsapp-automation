import { z } from 'zod';
import {
  agentResultSchema,
  normalizeAgentReply,
  type AgentIntent,
  type AgentLanguage,
  type AgentResult,
} from './agent-result';
import type { CustomerServiceToolName } from './agent-diagnostics';

export const customerServiceCapabilitySchema = z.enum([
  'LIST_AVAILABLE_ENTITIES',
  'CHECK_ENTITY_FIELD',
  'CHECK_OPENING_HOURS',
  'CHECK_BUSINESS_RULES',
]);
export type CustomerServiceCapability = z.infer<typeof customerServiceCapabilitySchema>;

const entityTypeKeySchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const entityFieldKeySchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const pendingCustomerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LIST_AVAILABLE_ENTITIES'), entityType: entityTypeKeySchema }).strict(),
  z.object({
    type: z.literal('CHECK_ENTITY_FIELD'),
    entityType: entityTypeKeySchema,
    field: entityFieldKeySchema,
    label: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({ type: z.literal('CHECK_OPENING_HOURS') }).strict(),
  z.object({ type: z.literal('CHECK_BUSINESS_RULES') }).strict(),
]);
export const pendingCustomerActionsSchema = z.array(pendingCustomerActionSchema).max(2);
export type PendingCustomerAction = z.infer<typeof pendingCustomerActionSchema>;

export const requestedCustomerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LIST_AVAILABLE_ENTITIES'), entityType: entityTypeKeySchema }).strict(),
  z.object({
    type: z.literal('CHECK_ENTITY_FIELD'),
    entityType: entityTypeKeySchema,
    field: entityFieldKeySchema,
  }).strict(),
  z.object({ type: z.literal('CHECK_OPENING_HOURS') }).strict(),
  z.object({ type: z.literal('CHECK_BUSINESS_RULES') }).strict(),
]);
export const requestedCustomerActionsSchema = z.array(requestedCustomerActionSchema).max(2);
export type RequestedCustomerAction = z.infer<typeof requestedCustomerActionSchema>;

const CAPABILITY_REQUIREMENTS: Readonly<Record<CustomerServiceCapability, readonly CustomerServiceToolName[]>> = {
  LIST_AVAILABLE_ENTITIES: ['listEntityTypes', 'searchBusinessEntities'],
  CHECK_ENTITY_FIELD: ['listEntityTypes', 'searchBusinessEntities'],
  CHECK_OPENING_HOURS: ['getOpeningHours'],
  CHECK_BUSINESS_RULES: ['getBusinessRules'],
};

export const resolveCustomerServiceCapabilities = (
  enabledTools: ReadonlySet<CustomerServiceToolName>,
): readonly CustomerServiceCapability[] => customerServiceCapabilitySchema.options.filter(capability =>
  CAPABILITY_REQUIREMENTS[capability].every(tool => enabledTools.has(tool)));

export const isPendingActionAvailable = (
  action: RequestedCustomerAction,
  capabilities: readonly CustomerServiceCapability[],
): boolean => capabilities.includes(action.type);

const ACCEPTANCE_PATTERNS = [
  /^(?:yes|yeah|yep|ok(?:ay)?|sure|please)\s*(?:do|check)?\s*(?:it|that)?[.!?]*$/iu,
  /^(?:do|check)\s+(?:it|that)[.!?]*$/iu,
  /^go\s+ahead[.!?]*$/iu,
  /^(?:oui|d'accord|vas[- ]y|faites[- ]le|vérifie(?:z)?\s+ça)[.!?]*$/iu,
  /^(?:نعم|واخا|ديرها|شوفها|تأكد)[.!؟?]*$/u,
  /^(?:wakha|iyah|dirha|chofha)[.!?]*$/iu,
];

export const isPendingActionAcceptance = (message: string): boolean =>
  ACCEPTANCE_PATTERNS.some(pattern => pattern.test(message.trim()));

export type UnsupportedCapabilityKind =
  | 'BOOKING'
  | 'DELIVERY'
  | 'DISCOUNT_OR_REFUND'
  | 'PAYMENT'
  | 'CONTACT_STAFF';

const UNSUPPORTED_REQUEST_PATTERNS: readonly {
  readonly kind: UnsupportedCapabilityKind;
  readonly pattern: RegExp;
}[] = [
  { kind: 'BOOKING', pattern: /\b(?:book|reserve|make|create|confirm)\b.{0,32}\b(?:booking|reservation|appointment|it|car|vehicle)\b|\b(?:book|reserve)\s+(?:it|this|that|the)\b/iu },
  { kind: 'DELIVERY', pattern: /\b(?:arrange|book|schedule|send|deliver)\b.{0,32}\bdelivery\b/iu },
  { kind: 'DISCOUNT_OR_REFUND', pattern: /\b(?:apply|give|issue|process|arrange|confirm)\b.{0,32}\b(?:discount|refund)\b/iu },
  { kind: 'PAYMENT', pattern: /\b(?:take|make|process|charge|collect|confirm)\b.{0,32}\bpayment\b/iu },
  { kind: 'CONTACT_STAFF', pattern: /\b(?:contact|call|message|notify|email)\b.{0,32}\b(?:the\s+)?(?:team|staff|manager|owner|person|human)\b/iu },
];

export const detectUnsupportedCapabilityRequest = (message: string): UnsupportedCapabilityKind | null =>
  UNSUPPORTED_REQUEST_PATTERNS.find(candidate => candidate.pattern.test(message))?.kind ?? null;

const MODEL_CAPABILITY_CLAIM = /\b(?:would\s+you\s+like\s+(?:me|us)\s+to|(?:i|we)(?:\s+(?:can|could|will)|['’]ll)\s+(?!not\b|never\b)|(?:i\s+am|we\s+are|i['’]m|we['’]re)\s+(?:able|happy|ready)\s+to|let\s+me\s+|(?:the\s+)?(?:team|staff|manager)\s+(?:can|will)\s+)\b/iu;
const UNSUPPORTED_CAPABILITY_ASSERTION = /\b(?:reservation\s+(?:is\s+)?confirmed|delivery\s+(?:is\s+)?arranged|payment\s+(?:was|is|has\s+been)?\s*processed|refund\s+(?:was|is|has\s+been)?\s*(?:issued|processed))\b/iu;
const GENERIC_CLOSER = /\b(?:would\s+you\s+like\s+(?:help|assistance)\s+with\s+anything\s+else|is\s+there\s+anything\s+else\s+i\s+can\s+(?:help|assist)\s+with)\b/iu;
const SYSTEM_NARRATION_PREFIXES = [
  /^based\s+on\s+(?:our|the)\s+(?:latest|available|current)\s+(?:information|data)\s*[,;:]?\s*/iu,
  /^according\s+to\s+(?:our|the)\s+(?:system|records|database)\s*[,;:]?\s*/iu,
  /^(?:our|the)\s+(?:system|database)\s+(?:shows|indicates)(?:\s+that)?\s*[,;:]?\s*/iu,
  /^i\s+(?:have\s+)?checked\s+(?:our|the)\s+(?:system|records|database|available\s+data)\s*[,;:]?\s*/iu,
];

const removeNarrationPrefix = (value: string): string => {
  let normalized = value.trim();
  for (const pattern of SYSTEM_NARRATION_PREFIXES) normalized = normalized.replace(pattern, '');
  if (normalized !== value.trim() && normalized) {
    normalized = `${normalized[0]!.toLocaleUpperCase()}${normalized.slice(1)}`;
  }
  return normalized.trim();
};

const removeModelCapabilityClaims = (value: string): string => value
  .split(/(?<=[.!?])\s+|\n+/u)
  .map(sentence => {
    const claimIndex = sentence.search(MODEL_CAPABILITY_CLAIM);
    const closerIndex = sentence.search(GENERIC_CLOSER);
    const assertionIndex = sentence.search(UNSUPPORTED_CAPABILITY_ASSERTION);
    const cutAt = [claimIndex, closerIndex, assertionIndex].filter(index => index >= 0).sort((left, right) => left - right)[0];
    return removeNarrationPrefix(cutAt === undefined ? sentence : sentence.slice(0, cutAt));
  })
  .filter(Boolean)
  .join(' ')
  .trim();

const ACTION_LABELS: Readonly<Record<AgentLanguage, Readonly<Record<Exclude<CustomerServiceCapability, 'CHECK_ENTITY_FIELD'>, string>>>> = {
  en: { LIST_AVAILABLE_ENTITIES: 'the other available options', CHECK_OPENING_HOURS: 'our opening hours', CHECK_BUSINESS_RULES: 'the relevant business rules' },
  fr: { LIST_AVAILABLE_ENTITIES: 'les autres options disponibles', CHECK_OPENING_HOURS: "nos horaires d'ouverture", CHECK_BUSINESS_RULES: 'les conditions concernées' },
  ar: { LIST_AVAILABLE_ENTITIES: 'الخيارات الأخرى المتاحة', CHECK_OPENING_HOURS: 'أوقات العمل', CHECK_BUSINESS_RULES: 'القواعد المتعلقة بطلبك' },
  'darija-arabic': { LIST_AVAILABLE_ENTITIES: 'الاختيارات الأخرى اللي كاينة', CHECK_OPENING_HOURS: 'أوقات الخدمة', CHECK_BUSINESS_RULES: 'القوانين اللي كيتعلقو بطلبك' },
  'darija-latin': { LIST_AVAILABLE_ENTITIES: 'les autres options li kaynin', CHECK_OPENING_HOURS: 'horaires dyalna', CHECK_BUSINESS_RULES: 'les règles li kaynin 3la talab dyalk' },
  mixed: { LIST_AVAILABLE_ENTITIES: 'les autres options li kaynin', CHECK_OPENING_HOURS: 'nos horaires', CHECK_BUSINESS_RULES: 'les règles concernées' },
  other: { LIST_AVAILABLE_ENTITIES: 'the other available options', CHECK_OPENING_HOURS: 'our opening hours', CHECK_BUSINESS_RULES: 'the relevant business rules' },
};

const actionLabel = (action: PendingCustomerAction, language: AgentLanguage): string =>
  action.type === 'CHECK_ENTITY_FIELD' ? action.label : ACTION_LABELS[language][action.type];

export const appendApplicationOwnedOffer = (
  reply: string,
  actions: readonly PendingCustomerAction[],
  language: AgentLanguage,
): string => {
  const safeReply = removeModelCapabilityClaims(reply);
  const fallback = safeReply || ({
    en: 'I can help with current business information.',
    fr: "Je peux vous aider avec les informations actuelles de l'entreprise.",
    ar: 'يمكنني مساعدتك بالمعلومات الحالية عن النشاط التجاري.',
    'darija-arabic': 'نقدر نعاونك بالمعلومات الحالية على المحل.',
    'darija-latin': 'N9der n3awnek b les informations actuelles dyal lbusiness.',
    mixed: 'N9der n3awnek avec les informations actuelles dyal lbusiness.',
    other: 'I can help with current business information.',
  })[language];
  if (actions.length === 0) return normalizeAgentReply(fallback);

  const labels = actions.map(action => actionLabel(action, language));
  const offer = actions.length === 1
    ? ({
      en: `I can also check ${labels[0]}.`, fr: `Je peux aussi vérifier ${labels[0]}.`, ar: `يمكنني أيضاً التحقق من ${labels[0]}.`,
      'darija-arabic': `نقدر حتى نشوف ليك ${labels[0]}.`, 'darija-latin': `N9der ta nchof lik ${labels[0]}.`,
      mixed: `N9der aussi nchof lik ${labels[0]}.`, other: `I can also check ${labels[0]}.`,
    })[language]
    : ({
      en: `I can check ${labels[0]} or ${labels[1]}.`, fr: `Je peux vérifier ${labels[0]} ou ${labels[1]}.`, ar: `يمكنني التحقق من ${labels[0]} أو ${labels[1]}.`,
      'darija-arabic': `نقدر نشوف ليك ${labels[0]} ولا ${labels[1]}.`, 'darija-latin': `N9der nchof lik ${labels[0]} wla ${labels[1]}.`,
      mixed: `N9der vérifier ${labels[0]} wla ${labels[1]}.`, other: `I can check ${labels[0]} or ${labels[1]}.`,
    })[language];
  return normalizeAgentReply(`${fallback} ${offer}`);
};

export const createPendingActionClarification = (
  actions: readonly PendingCustomerAction[],
  language: AgentLanguage,
): AgentResult => {
  const labels = actions.map(action => actionLabel(action, language));
  const reply = ({
    en: `Do you mean ${labels[0]} or ${labels[1]}?`, fr: `Vous voulez dire ${labels[0]} ou ${labels[1]} ?`,
    ar: `هل تقصد ${labels[0]} أم ${labels[1]}؟`, 'darija-arabic': `واخا، قصدك ${labels[0]} ولا ${labels[1]}؟`,
    'darija-latin': `Wakha, kat9sed ${labels[0]} wla ${labels[1]}?`, mixed: `Wakha, vous voulez dire ${labels[0]} wla ${labels[1]}?`,
    other: `Do you mean ${labels[0]} or ${labels[1]}?`,
  })[language];
  return agentResultSchema.parse({ reply, needsHuman: false, detectedIntent: 'BUSINESS_INFORMATION', reasonCode: 'CLARIFICATION_NEEDED', detectedLanguage: language });
};

const UNSUPPORTED_REPLIES: Readonly<Record<UnsupportedCapabilityKind, Readonly<Record<AgentLanguage, string>>>> = {
  BOOKING: {
    en: "I can check the current price and availability, but I can't make a reservation.", fr: "Je peux vérifier le prix et la disponibilité, mais je ne peux pas effectuer de réservation.",
    ar: 'يمكنني التحقق من السعر والتوفر، لكن لا يمكنني إجراء حجز.', 'darija-arabic': 'نقدر نشوف ليك الثمن وواش كاينة، ولكن ما نقدرش ندير الحجز.',
    'darija-latin': 'N9der nchof lik taman w disponibilité, walakin ma n9derch ndir réservation.', mixed: 'N9der vérifier le prix et la disponibilité, mais ma n9derch ndir la réservation.', other: "I can check the current price and availability, but I can't make a reservation.",
  },
  DELIVERY: {
    en: "I can't arrange delivery. I can check our current delivery rules if there are any.", fr: "Je ne peux pas organiser une livraison. Je peux vérifier nos conditions de livraison actuelles s'il y en a.",
    ar: 'لا يمكنني ترتيب التوصيل. يمكنني التحقق من قواعد التوصيل الحالية إن وجدت.', 'darija-arabic': 'ما نقدرش نرتب التوصيل. نقدر نشوف قوانين التوصيل الحالية إلا كانت.',
    'darija-latin': 'Ma n9derch norganizi livraison. N9der nchof les règles actuelles dyal livraison ila kaynin.', mixed: 'Ma n9derch organiser la livraison. Je peux vérifier les règles actuelles de livraison ila kaynin.', other: "I can't arrange delivery. I can check our current delivery rules if there are any.",
  },
  DISCOUNT_OR_REFUND: {
    en: "I can't apply discounts or issue refunds.", fr: "Je ne peux pas appliquer de remise ni effectuer de remboursement.", ar: 'لا يمكنني تطبيق خصم أو إصدار استرداد.',
    'darija-arabic': 'ما نقدرش نطبق تخفيض ولا ندير استرجاع الفلوس.', 'darija-latin': 'Ma n9derch nappliqui discount wla ndir remboursement.', mixed: 'Ma n9derch appliquer une remise ou faire un remboursement.', other: "I can't apply discounts or issue refunds.",
  },
  PAYMENT: {
    en: "I can't take or process payments.", fr: "Je ne peux pas accepter ni traiter de paiement.", ar: 'لا يمكنني استلام أو معالجة المدفوعات.',
    'darija-arabic': 'ما نقدرش ناخد ولا نعالج الدفع.', 'darija-latin': 'Ma n9derch nakhod wla nprocessi paiement.', mixed: 'Ma n9derch accepter ou traiter un paiement.', other: "I can't take or process payments.",
  },
  CONTACT_STAFF: {
    en: "I can't contact the team automatically, but your request needs staff attention.", fr: "Je ne peux pas contacter l'équipe automatiquement, mais votre demande nécessite son intervention.",
    ar: 'لا يمكنني التواصل مع الفريق تلقائياً، لكن طلبك يحتاج إلى تدخل الموظفين.', 'darija-arabic': 'ما نقدرش نتاصل بالفريق أوتوماتيكياً، ولكن الطلب ديالك خاصو تدخل ديالهم.',
    'darija-latin': "Ma n9derch ncontacti l'équipe automatiquement, walakin talab dyalk khaso tadakhkhul dyalhom.", mixed: "Ma n9derch contacter l'équipe automatiquement, mais talab dyalk khaso leur intervention.", other: "I can't contact the team automatically, but your request needs staff attention.",
  },
};

export const createUnsupportedCapabilityResult = (
  kind: UnsupportedCapabilityKind,
  language: AgentLanguage,
  detectedIntent: AgentIntent,
): AgentResult => agentResultSchema.parse({
  reply: UNSUPPORTED_REPLIES[kind][language],
  needsHuman: kind === 'CONTACT_STAFF',
  detectedIntent: kind === 'CONTACT_STAFF' ? 'HUMAN_REQUEST' : detectedIntent === 'UNKNOWN' ? 'BUSINESS_INFORMATION' : detectedIntent,
  reasonCode: kind === 'CONTACT_STAFF' ? 'CUSTOMER_REQUESTED_HUMAN' : 'UNSUPPORTED_ACTION',
  detectedLanguage: language,
});

export const buildAcceptedActionInstructions = (action: PendingCustomerAction): string => {
  if (action.type === 'LIST_AVAILABLE_ENTITIES') {
    return `The customer accepted the application-authorized pending action. Search current entities of type ${JSON.stringify(action.entityType)} and answer with the available options. Do not repeat the earlier answer or offer another action unless it is registered through the action-offer tool.`;
  }
  if (action.type === 'CHECK_OPENING_HOURS') {
    return 'The customer accepted the application-authorized pending action. Call getOpeningHours and answer with the current opening hours. Do not repeat the earlier answer.';
  }
  if (action.type === 'CHECK_ENTITY_FIELD') {
    return `The customer accepted the application-authorized pending action. Search current entities of type ${JSON.stringify(action.entityType)} and retrieve field ${JSON.stringify(action.field)}. Use recent conversation context to resolve the specific item, and answer only from the current tool result. Do not repeat the earlier answer.`;
  }
  return 'The customer accepted the application-authorized pending action. Call getBusinessRules and answer only with the relevant current rules. Do not repeat the earlier answer.';
};
