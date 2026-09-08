import type { ConversationHistory } from './conversation-context';
import { agentResultSchema, type AgentLanguage, type AgentResult } from './agent-result';
import type { BusinessContext } from './business-context';

export type CustomerScope = 'BUSINESS_RELATED' | 'OUT_OF_SCOPE';

export interface CustomerScopeDecision {
  readonly scope: CustomerScope;
  readonly modelMessage: string;
  readonly partiallyRelated: boolean;
}

const BUSINESS_OBJECT_TERMS = new Set([
  'business', 'company', 'product', 'products', 'car', 'cars', 'vehicle', 'vehicles',
  'deposit', 'delivery', 'membership', 'appointment', 'salon', 'haircut', 'gym', 'order',
  'entreprise', 'société', 'societe', 'produit', 'produits', 'voiture', 'voitures', 'véhicule',
  'véhicules', 'vehicule', 'vehicules', 'caution', 'livraison', 'abonnement', 'commande',
  'خدمة', 'خدمات', 'منتج', 'منتجات', 'سيارة', 'سيارات', 'طوموبيل', 'طوموبيلات', 'ضمان',
  'توصيل', 'موعد', 'صالون', 'حلاقة', 'اشتراك', 'طلب', 'tomobil', 'tomobila', 'produit',
]);

const CUSTOMER_SERVICE_SIGNALS = new Set([
  'price', 'cost', 'rate', 'available', 'availability', 'book', 'booking', 'reserve', 'reservation',
  'rent', 'rental', 'rentals', 'return', 'buy', 'purchase', 'order', 'delivery', 'deposit',
  'prix', 'tarif', 'disponible', 'disponibilité', 'disponibilite', 'réserver', 'reserver', 'location',
  'louer', 'retour', 'acheter', 'commande', 'livraison', 'caution',
  'ثمن', 'سعر', 'متوفر', 'متوفرة', 'متاحة', 'حجز', 'نحجز', 'كراء', 'نكري', 'رجوع', 'شراء',
  'شحال', 'كاين', 'كاينة', 'chhal', 'taman', 'kayn', 'kayna', 'kira', 'nkri',
]);

const BUSINESS_RELATION_PHRASES = [
  /\bwhat\s+do\s+you\s+do\b/iu,
  /\btell\s+me\s+about\s+(?:your|the)\s+(?:business|company)\b/iu,
  /\b(?:do|can)\s+you\s+(?:have|offer|provide|sell|rent|deliver)\b/iu,
  /\b(?:what|which)\s+(?:products?|cars?|vehicles?|services?)\s+(?:do\s+you\s+)?(?:have|offer|provide|rent|sell|stock)\b/iu,
  /\b(?:is|are)\s+(?:an?\s+)?[\p{L}\s-]{1,40}\s+services?\s+available\b/iu,
  /\b(?:when|what\s+time)\s+(?:do|are)\s+you\s+(?:open|close|closed)\b/iu,
  /\b(?:where\s+are\s+you|where\s+is\s+(?:your|the)\s+(?:business|company|shop|office|salon|gym))\b/iu,
  /\b(?:your|the\s+business(?:'s)?)\s+(?:price|prices|rates?|availability|hours?|opening\s+hours?|address|location|rules?|polic(?:y|ies)|services?)\b/iu,
  /\b(?:can|could|may)\s+i\s+(?:book|reserve|rent|buy|order|return|collect|pick\s+up)\b/iu,
  /\bi\s+(?:want|need|would\s+like)\s+to\s+(?:book|reserve|rent|buy|order|return|complain)\b/iu,
  /\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:person|human|representative|staff|manager|agent)\b/iu,
  /\b(?:i\s+have|make|file)\s+(?:a\s+)?complaint\b/iu,
  /\bcurrent\s+(?:price|availability|rates?)\b/iu,
  /\bshow\s+(?:me\s+)?(?:the\s+)?current\s+business\s+(?:info|information)\b/iu,
  /\b(?:rental|car\s+rental)\s+(?:rules?|polic(?:y|ies)|conditions?|price|rates?|deposit|availability)\b/iu,
  /\bque\s+faites[- ]vous\b/iu,
  /\b(?:avez[- ]vous|proposez[- ]vous|louez[- ]vous|vendez[- ]vous)\b/iu,
  /\b(?:vos|votre)\s+(?:prix|tarifs?|disponibilités?|disponibilites?|horaires?|adresse|règles?|regles?|conditions?|services?)\b/iu,
  /\b(?:parler|discuter)\s+(?:à|a|avec)\s+(?:une?\s+)?(?:personne|conseiller|conseillère|responsable|agent)\b/iu,
  /\b(?:plainte|réclamation|reclamation)\b/iu,
  /شنو\s+(?:كتديرو|الخدمات)/u,
  /(?:واش|هل)\s+(?:عندكم|لديكم)/u,
  /(?:بغيت|أريد)\s+(?:نحجز|نكري|نشتري|نهضر\s+مع)/u,
  /ما\s+هي\s+[أا]وقات\s+العمل/u,
  /ach\s+katdirou/iu,
  /(?:wach|wash)\s+(?:3ndkom|andkom)/iu,
  /bghit\s+(?:n7jez|nhjez|nkri|nchri|nhder\s+m3a)/iu,
  /^(?:a\s+)?(?:person|human|representative|staff|manager|agent)\s+please[?.!]?$/iu,
];

const COMPACT_BUSINESS_REQUESTS = [
  /^(?:what(?:'s|\s+is|\s+are)?\s+)?(?:the\s+)?(?:current\s+)?(?:price|cost|rates?|availability|hours?|opening\s+hours?|rules?|polic(?:y|ies))\??$/iu,
  /^(?:prix|tarif|disponibilité|disponibilite|horaires?|règles?|regles?|conditions?)\??$/iu,
  /^(?:ثمن|سعر|شحال|التوفر|أوقات\s+العمل|اوقات\s+العمل|القوانين|الشروط)[؟?]?$/u,
];

const NAMED_CATALOG_REQUESTS = [
  /\b(?:price|cost|rate)\s+(?:of|for)\s+the\s+[\p{L}\p{N}-]+/iu,
  /\b(?:price|cost|rate)\s+(?:of|for|at|from)\s+(?:the\s+)?\p{Lu}[\p{L}\p{N}-]*/u,
  /\bhow\s+much\s+(?:is|does)\s+the\s+[\p{L}\p{N}-]+/iu,
  /\bhow\s+much\s+(?:is|does)\s+(?:the\s+)?\p{Lu}[\p{L}\p{N}-]*/u,
  /\b\p{Lu}[\p{L}\p{N}-]*(?:\s+\p{Lu}[\p{L}\p{N}-]*)?\s+(?:daily\s+)?(?:price|cost|rate|available|availability)\b/u,
  /\b(?:prix|tarif)\s+(?:de|du|pour)\s+(?:la\s+|le\s+|l['’])?\p{Lu}[\p{L}\p{N}-]*/u,
  /\b(?:quel\s+est\s+le\s+prix|combien\s+coûte|combien\s+coute)\s+(?:de\s+|du\s+|la\s+|le\s+)?\p{Lu}[\p{L}\p{N}-]*/u,
  /(?:ثمن|سعر)\s+[\p{Script=Arabic}\p{N}-]{2,30}(?:\s+[\p{Script=Arabic}\p{N}-]{2,30})?[؟?]?$/u,
  /\b(?:chhal|taman)\b.{0,40}\b\p{Lu}[\p{L}\p{N}-]*/u,
  /^find\s+(?:the\s+)?\p{Lu}[\p{L}\p{N}-]*(?:\s+\p{Lu}[\p{L}\p{N}-]*)?[?.!]?$/u,
];

const NEUTRAL_GREETINGS = new Set([
  'hello', 'hi', 'hey', 'bonjour', 'bonsoir', 'salut', 'سلام', 'salam',
]);

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

const containsBusinessRelation = (value: string): boolean => {
  const clauseTokens = tokens(value);
  const hasBusinessObject = clauseTokens.some(token => BUSINESS_OBJECT_TERMS.has(token));
  const hasCustomerServiceSignal = clauseTokens.some(token => CUSTOMER_SERVICE_SIGNALS.has(token));

  return BUSINESS_RELATION_PHRASES.some(pattern => pattern.test(value)) ||
    COMPACT_BUSINESS_REQUESTS.some(pattern => pattern.test(value.trim())) ||
    NAMED_CATALOG_REQUESTS.some(pattern => pattern.test(value)) ||
    (hasBusinessObject && hasCustomerServiceSignal);
};

const isBusinessClause = (value: string, hasBusinessHistory: boolean): boolean => {
  if (ROLE_ESCAPE.some(pattern => pattern.test(value)) || INTERNAL_REQUEST.some(pattern => pattern.test(value))) {
    return false;
  }
  return containsBusinessRelation(value) ||
    (hasBusinessHistory && FOLLOW_UP.some(pattern => pattern.test(value)));
};

const isNeutralGreeting = (value: string): boolean =>
  tokens(value).some(token => NEUTRAL_GREETINGS.has(token)) && tokens(value).length <= 3;

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
