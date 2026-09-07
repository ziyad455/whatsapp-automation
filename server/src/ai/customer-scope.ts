import type { ConversationHistory } from './conversation-context';
import { agentResultSchema, type AgentLanguage, type AgentResult } from './agent-result';
import { analyzeCustomerMessage } from './customer-message-analysis';
import type { BusinessContext } from './business-context';

export type CustomerScope = 'BUSINESS_RELATED' | 'OUT_OF_SCOPE';

export interface CustomerScopeDecision {
  readonly scope: CustomerScope;
  readonly modelMessage: string;
  readonly partiallyRelated: boolean;
}

const BUSINESS_INTENTS = new Set([
  'BUSINESS_INFORMATION',
  'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY',
  'BOOKING_INTENT',
  'HUMAN_REQUEST',
  'COMPLAINT',
]);

const BUSINESS_TERMS = new Set([
  'business', 'service', 'services', 'product', 'products', 'car', 'cars', 'vehicle', 'vehicles',
  'rent', 'rental', 'rentals', 'deposit', 'delivery', 'return', 'membership', 'appointment', 'salon',
  'haircut', 'gym', 'order', 'purchase', 'phone', 'contact',
  'entreprise', 'voiture', 'voitures', 'véhicule', 'véhicules', 'location', 'louer', 'caution',
  'livraison', 'retour', 'abonnement', 'commande', 'acheter', 'téléphone', 'contact',
  'خدمة', 'خدمات', 'منتج', 'منتجات', 'سيارة', 'سيارات', 'طوموبيل', 'طوموبيلات', 'كراء',
  'نكري', 'ضمان', 'توصيل', 'رجوع', 'موعد', 'صالون', 'حلاقة', 'اشتراك', 'طلب', 'شراء',
  'tomobil', 'tomobila', 'kira', 'nkri', 'service', 'produit', 'livraison', 'rendezvous',
]);

const BUSINESS_PHRASES = [
  /\bwhat\s+do\s+you\s+do\b/iu,
  /\btell\s+me\s+about\s+(?:your|the)\s+(?:business|company)\b/iu,
  /\bque\s+faites[- ]vous\b/iu,
  /شنو\s+(?:كتديرو|الخدمات)/u,
  /ach\s+katdirou/iu,
];

const ROLE_ESCAPE = [
  /\b(?:ignore|forget|override)\b.{0,60}\b(?:instructions?|rules?|business|role)\b/iu,
  /\b(?:act|behave)\s+(?:like|as)\b/iu,
  /\bdeveloper\s+mode\b/iu,
  /\byou\s+are\s+now\b/iu,
  /\b(?:oublie|ignore)\b.{0,60}\b(?:instructions?|règles?|entreprise|rôle)\b/iu,
  /(?:انسى|تجاهل).{0,60}(?:التعليمات|القواعد|الشركة|الدور)/u,
  /(?:nsa|tjahal|ignore).{0,60}(?:instructions?|rules?|business)/iu,
  /\bforget\b.{0,80}\banswer\s+normally\b/iu,
];

const INTERNAL_REQUEST = [
  /\b(?:system|developer|hidden)\s+(?:prompt|instructions?|message)\b/iu,
  /\b(?:internal|hidden)\s+(?:tools?|architecture|configuration)\b/iu,
  /(?:برومبت|تعليمات|أدوات).{0,30}(?:سرية|داخلية|مخفية)/u,
  /\b(?:prompt|instructions?|outils)\s+(?:système|caché(?:es?)?|internes?)\b/iu,
];

const FOLLOW_UP = [
  /^(?:and|but|so)?\s*(?:what|how)\s+about\b/iu,
  /^(?:and|but|so)\b/iu,
  /\b(?:it|that|those|the first|the second|the automatic one)\b/iu,
  /^(?:et|mais|alors)\b/iu,
  /\b(?:ça|cela|celui|celle|le premier|la première)\b/iu,
  /(?:و|ولكن|وداك|هادا|هديك|الأول|الثاني)/u,
  /^(?:w|walakin)\b/iu,
];

const tokens = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const containsBusinessLanguage = (value: string): boolean =>
  tokens(value).some(token => BUSINESS_TERMS.has(token)) ||
  BUSINESS_PHRASES.some(pattern => pattern.test(value));

const isBusinessClause = (value: string, hasBusinessHistory: boolean): boolean => {
  if (ROLE_ESCAPE.some(pattern => pattern.test(value)) || INTERNAL_REQUEST.some(pattern => pattern.test(value))) {
    return false;
  }
  const intent = analyzeCustomerMessage(value).detectedIntent;
  return BUSINESS_INTENTS.has(intent) || containsBusinessLanguage(value) ||
    (hasBusinessHistory && FOLLOW_UP.some(pattern => pattern.test(value)));
};

const isNeutralGreeting = (value: string): boolean =>
  analyzeCustomerMessage(value).detectedIntent === 'GENERAL_QUESTION';

const hasRecentBusinessContext = (history?: ConversationHistory): boolean =>
  history?.messages.slice(-4).some(message =>
    message.role === 'user' && isBusinessClause(message.content, false)) ?? false;

const splitClauses = (message: string): string[] =>
  message.split(/(?:[.!?;:\n]+|\b(?:and|but|also|et|mais|puis)\b)/giu)
    .map(clause => clause.trim())
    .filter(Boolean);

export const classifyCustomerScope = (
  message: string,
  history?: ConversationHistory,
): CustomerScopeDecision => {
  const wholeMessageRoleEscape = ROLE_ESCAPE.some(pattern => pattern.test(message));
  const wholeMessageIntent = analyzeCustomerMessage(message).detectedIntent;
  if (wholeMessageRoleEscape && !BUSINESS_INTENTS.has(wholeMessageIntent)) {
    return { scope: 'OUT_OF_SCOPE', modelMessage: '', partiallyRelated: false };
  }
  const clauses = splitClauses(message);
  const hasBusinessHistory = hasRecentBusinessContext(history);
  const supported = clauses.filter(clause => isBusinessClause(clause, hasBusinessHistory));
  const neutral = clauses.filter(isNeutralGreeting);
  const unsupported = clauses.filter(clause =>
    !supported.includes(clause) && !neutral.includes(clause));

  if (supported.length === 0) {
    if (unsupported.length === 0 && neutral.length > 0) {
      return { scope: 'BUSINESS_RELATED', modelMessage: message, partiallyRelated: false };
    }
    return { scope: 'OUT_OF_SCOPE', modelMessage: '', partiallyRelated: false };
  }

  return {
    scope: 'BUSINESS_RELATED',
    modelMessage: unsupported.length > 0 ? supported.join(' ') : message,
    partiallyRelated: unsupported.length > 0,
  };
};

const replyForLanguage = (
  language: AgentLanguage,
  businessName: string,
): string => ({
  en: `I can help with questions about ${businessName}, our services, prices, availability, opening hours, or policies.`,
  fr: `Je peux vous aider pour toute question sur ${businessName}, nos services, tarifs, disponibilités, horaires ou conditions.`,
  ar: `يمكنني مساعدتك في الأسئلة المتعلقة بـ ${businessName} وخدماتنا وأسعارنا والتوفر وأوقات العمل والسياسات.`,
  'darija-arabic': `نقدر نعاونك فالأسئلة على ${businessName}، الخدمات، الثمن، واش كاين، أوقات الخدمة ولا القوانين.`,
  'darija-latin': `N9der n3awnek f ay sou2al 3la ${businessName}, services, taman, disponibilité, horaires, wla les règles.`,
  mixed: `N9der n3awnek pour toute question sur ${businessName}, les services, prix, disponibilité, horaires, wla les règles.`,
  other: `I can help with questions about ${businessName}, our services, prices, availability, opening hours, or policies.`,
})[language];

export const createOutOfScopeAgentResult = (
  business: BusinessContext,
  language: AgentLanguage,
): AgentResult => agentResultSchema.parse({
  reply: replyForLanguage(language, business.name),
  needsHuman: false,
  detectedIntent: 'OUT_OF_SCOPE',
  reasonCode: 'OUT_OF_SCOPE',
  detectedLanguage: language,
});
