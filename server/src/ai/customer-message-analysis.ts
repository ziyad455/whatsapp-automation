import type { AgentIntent, AgentLanguage } from './agent-result';

export interface CustomerMessageAnalysis {
  readonly detectedIntent: AgentIntent;
  readonly detectedLanguage: AgentLanguage;
}

const tokenize = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const containsPhrase = (tokens: readonly string[], phrase: readonly string[]): boolean => {
  if (phrase.length > tokens.length) return false;
  return tokens.some((_, start) =>
    phrase.every((word, offset) => tokens[start + offset] === word));
};

const containsAny = (tokens: readonly string[], phrases: readonly (readonly string[])[]): boolean =>
  phrases.some(phrase => containsPhrase(tokens, phrase));

const HUMAN_PHRASES = [
  ['human'], ['person'], ['someone'], ['representative'], ['staff'], ['manager'],
  ['human', 'agent'], ['live', 'agent'],
  ['humain'], ['humaine'], ['personne'], ['conseiller'], ['conseillère'], ['responsable'],
  ['agent', 'humain'],
  ['شخص'], ['موظف'], ['مسؤول'], ['انسان'], ['إنسان'], ['بغيت', 'نهضر', 'مع'], ['بغيت', 'شي', 'واحد'],
  ['bghit', 'nhder', 'm3a'], ['bghit', 'chi', 'wahed'],
] as const;
const COMPLAINT_PHRASES = [
  ['complaint'], ['complain'], ['plainte'], ['réclamation'], ['reclamation'], ['شكوى'], ['شكاية'],
] as const;
const BOOKING_PHRASES = [
  ['book'], ['booking'], ['reserve'], ['reservation'], ['appointment'], ['rendez', 'vous'],
  ['حجز'], ['موعد'], ['نحجز'], ['بغيت', 'نحجز'], ['bghit', 'n7jez'], ['bghit', 'nhjez'],
] as const;
const PRICE_PHRASES = [
  ['price'], ['cost'], ['how', 'much'], ['rate'], ['prix'], ['tarif'], ['combien'],
  ['ثمن'], ['سعر'], ['شحال'], ['chhal'], ['taman'],
] as const;
const AVAILABILITY_PHRASES = [
  ['available'], ['availability'], ['in', 'stock'], ['disponible'], ['disponibilité'], ['disponibilite'],
  ['متوفر'], ['متوفرة'], ['متاحة'], ['واش', 'كاين'], ['واش', 'كاينة'], ['واش', 'عندكم'],
  ['kayn'], ['kayna'], ['wach', '3ndkom'],
] as const;
const BUSINESS_INFORMATION_PHRASES = [
  ['hours'], ['open'], ['close'], ['address'], ['location'], ['policy'], ['rules'],
  ['horaires'], ['ouvert'], ['fermé'], ['ferme'], ['adresse'], ['politique'],
  ['اوقات'], ['أوقات'], ['العنوان'], ['فين'], ['الوقت'], ['قانون'], ['wach', '7alin'],
] as const;
const GREETING_PHRASES = [
  ['hello'], ['hi'], ['hey'], ['bonjour'], ['bonsoir'], ['salut'], ['سلام'], ['salam'],
] as const;

const DARIJA_ARABIC_WORDS = new Set(['واش', 'شحال', 'بغيت', 'عندكم', 'شي', 'كاين', 'كاينة', 'فين', 'عفاك', 'طوموبيل']);
const DARIJA_LATIN_WORDS = new Set(['wach', 'chhal', 'bghit', '3ndkom', 'kayn', 'kayna', 'fin', 'afak', 'tomobil', 'bzaf']);
const ENGLISH_WORDS = new Set([
  'the', 'what', 'when', 'where', 'how', 'do', 'you', 'your', 'is', 'are', 'i', 'want', 'need',
  'talk', 'person', 'price', 'available', 'open', 'close', 'book', 'booking', 'current', 'daily',
  'hello', 'hi', 'please',
]);
const FRENCH_WORDS = new Set(['le', 'la', 'les', 'quel', 'quelle', 'quels', 'quelles', 'vos', 'votre', 'est', 'sont', 'prix', 'disponible', 'horaires', 'bonjour']);

const countMatches = (tokens: readonly string[], words: ReadonlySet<string>): number =>
  tokens.reduce((count, token) => count + Number(words.has(token)), 0);

const detectLanguage = (tokens: readonly string[]): AgentLanguage => {
  const hasArabicScript = tokens.some(token => /\p{Script=Arabic}/u.test(token));
  const darijaArabic = countMatches(tokens, DARIJA_ARABIC_WORDS);
  const darijaLatin = countMatches(tokens, DARIJA_LATIN_WORDS);
  const english = countMatches(tokens, ENGLISH_WORDS);
  const french = countMatches(tokens, FRENCH_WORDS);
  const latinSignals = darijaLatin + english + french;

  if (hasArabicScript && latinSignals > 0) return 'mixed';
  if (hasArabicScript) return darijaArabic > 0 ? 'darija-arabic' : 'ar';
  const activeLatinLanguages = [darijaLatin, english, french].filter(score => score > 0).length;
  if (activeLatinLanguages > 1) return 'mixed';
  if (darijaLatin > 0) return 'darija-latin';
  if (english > 0) return 'en';
  if (french > 0) return 'fr';
  return 'other';
};

const detectIntent = (tokens: readonly string[]): AgentIntent => {
  if (containsAny(tokens, HUMAN_PHRASES)) return 'HUMAN_REQUEST';
  if (containsAny(tokens, COMPLAINT_PHRASES)) return 'COMPLAINT';
  if (containsAny(tokens, BOOKING_PHRASES)) return 'BOOKING_INTENT';
  if (containsAny(tokens, PRICE_PHRASES)) return 'PRICE_INQUIRY';
  if (containsAny(tokens, AVAILABILITY_PHRASES)) return 'AVAILABILITY_INQUIRY';
  if (containsAny(tokens, BUSINESS_INFORMATION_PHRASES)) return 'BUSINESS_INFORMATION';
  if (containsAny(tokens, GREETING_PHRASES)) return 'GENERAL_QUESTION';
  return 'UNKNOWN';
};

// Only the customer input is classified. Assistant prose is never inspected for routing decisions.
export const analyzeCustomerMessage = (message: string): CustomerMessageAnalysis => {
  const tokens = tokenize(message);
  return {
    detectedIntent: detectIntent(tokens),
    detectedLanguage: detectLanguage(tokens),
  };
};
