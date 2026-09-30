export type ReplyStyleViolation =
  | 'ROBOTIC_NARRATION'
  | 'GENERIC_CLOSER'
  | 'RITUAL_OPENER'
  | 'CUSTOMER_ECHO'
  | 'SALES_PRESSURE'
  | 'EM_DASH'
  | 'INCOMPLETE_ENDING'
  | 'REPORT_FORMATTING'
  | 'EXCESSIVE_LENGTH';

const roboticNarrationPatterns = [
  /based on (?:(?:our|the) )?(?:latest|available|current) (?:data|information)/iu,
  /according to (?:our|the) (?:system|records|database)/iu,
  /(?:our|the) system (?:indicates|shows)/iu,
  /(?:listed|marked) (?:as )?.{0,80} in (?:our|the) system/iu,
  /i (?:have )?(?:checked|queried) (?:the )?(?:available )?data/iu,
  /i (?:have )?checked (?:our|the) system/iu,
  /(?:our|the) database shows/iu,
  /\b(?:database|businessdataprovider|freshness checker|tool results?|internal verification)\b/iu,
  /selon (?:notre|le) système/iu,
  /d'après (?:les|nos) données/iu,
  /(?:notre|la) base de données/iu,
  /(?:حسب|وفق[اأ]ً?) (?:النظام|السجلات)/u,
  /قاعدة البيانات/u,
];

const genericCloserPatterns = [
  /is there anything else i can (?:help|assist) you with/iu,
  /feel free to ask if you have (?:any )?other questions/iu,
  /i(?:'d| would) be happy to assist you further/iu,
  /let me know if there(?:'s| is) anything else/iu,
  /would you like (?:more details|assistance with anything else)/iu,
  /how else may i assist you/iu,
  /please let me know if you require further information/iu,
  /comment puis-je vous aider davantage/iu,
  /n'hésitez pas à me (?:dire|contacter)/iu,
  /كيف يمكنني مساعدتك (?:أكثر|أيضاً|أيضا)/u,
];

const ritualOpenerPatterns = [
  /^(?:absolutely|certainly|of course|great question)[!,.\s]/iu,
  /^(?:absolument|certainement|bien sûr|excellente question)[!,.\s]/iu,
];

const customerEchoPatterns = [
  /^(?:you are|you're) asking (?:me )?about/iu,
  /^(?:vous demandez|votre question concerne)/iu,
];

const salesPressurePatterns = [
  /\b(?:fantastic|amazing|unbeatable) deal\b/iu,
  /\b(?:secure|lock in) (?:your|the) booking\b/iu,
  /\bact now\b/iu,
];

export const evaluateReplyStyle = (
  reply: string,
  options: { readonly maxCharacters?: number } = {},
): ReplyStyleViolation[] => {
  const violations = new Set<ReplyStyleViolation>();
  const maxCharacters = options.maxCharacters ?? 700;

  if (roboticNarrationPatterns.some(pattern => pattern.test(reply))) {
    violations.add('ROBOTIC_NARRATION');
  }
  if (genericCloserPatterns.some(pattern => pattern.test(reply))) {
    violations.add('GENERIC_CLOSER');
  }
  if (ritualOpenerPatterns.some(pattern => pattern.test(reply))) {
    violations.add('RITUAL_OPENER');
  }
  if (customerEchoPatterns.some(pattern => pattern.test(reply))) {
    violations.add('CUSTOMER_ECHO');
  }
  if (salesPressurePatterns.some(pattern => pattern.test(reply))) {
    violations.add('SALES_PRESSURE');
  }
  if (reply.includes('—') || reply.includes(' -- ')) {
    violations.add('EM_DASH');
  }
  if (/\b(?:and|or|but|if|because|just|et|ou|mais|si)\s*[,.]*$/iu.test(reply)) {
    violations.add('INCOMPLETE_ENDING');
  }
  if (/^\s{0,3}#{1,6}\s/mu.test(reply) || (reply.match(/\*\*[^*]+:\*\*/gu)?.length ?? 0) > 1 || /[✅✔]/u.test(reply)) {
    violations.add('REPORT_FORMATTING');
  }
  if (reply.length > maxCharacters) {
    violations.add('EXCESSIVE_LENGTH');
  }

  return [...violations];
};
