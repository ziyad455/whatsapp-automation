export type ReplyStyleViolation =
  | 'ROBOTIC_NARRATION'
  | 'GENERIC_CLOSER'
  | 'REPORT_FORMATTING'
  | 'EXCESSIVE_LENGTH';

const roboticNarrationPatterns = [
  /based on (?:the )?(?:latest|available|current) data/iu,
  /according to (?:our|the) (?:system|records|database)/iu,
  /(?:our|the) system (?:indicates|shows)/iu,
  /(?:listed|marked) (?:as )?.{0,80} in (?:our|the) system/iu,
  /i (?:have )?(?:checked|queried) (?:the )?(?:available )?data/iu,
  /\b(?:database|businessdataprovider|freshness checker|tool results?|internal verification)\b/iu,
  /selon (?:notre|le) système/iu,
  /d'après (?:les|nos) données/iu,
  /(?:notre|la) base de données/iu,
  /(?:حسب|وفق[اأ]ً?) (?:النظام|السجلات)/u,
  /قاعدة البيانات/u,
];

const genericCloserPatterns = [
  /would you like (?:more details|assistance with anything else)/iu,
  /how else may i assist you/iu,
  /please let me know if you require further information/iu,
  /comment puis-je vous aider davantage/iu,
  /n'hésitez pas à me (?:dire|contacter)/iu,
  /كيف يمكنني مساعدتك (?:أكثر|أيضاً|أيضا)/u,
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
  if (/^\s{0,3}#{1,6}\s/mu.test(reply) || (reply.match(/\*\*[^*]+:\*\*/gu)?.length ?? 0) > 1 || /[✅✔]/u.test(reply)) {
    violations.add('REPORT_FORMATTING');
  }
  if (reply.length > maxCharacters) {
    violations.add('EXCESSIVE_LENGTH');
  }

  return [...violations];
};
