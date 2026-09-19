import type { AgentIntent } from '../src/ai/agent-result';

export interface LeadQualificationEvaluationCase {
  readonly name: string;
  readonly message: string;
  readonly expectedIntent: AgentIntent;
  readonly qualifies: boolean;
}

export const leadQualificationCases: readonly LeadQualificationEvaluationCase[] = [
  { name: 'English greeting', message: 'Hello', expectedIntent: 'GENERAL_QUESTION', qualifies: false },
  { name: 'English hours', message: 'What time do you open?', expectedIntent: 'BUSINESS_INFORMATION', qualifies: false },
  { name: 'English price only', message: 'How much is the Clio?', expectedIntent: 'PRICE_INQUIRY', qualifies: false },
  { name: 'English planned rental', message: 'I need the Clio for 5 days starting Monday.', expectedIntent: 'PURCHASE_INTENT', qualifies: true },
  { name: 'English booking', message: 'I want to reserve the automatic car tomorrow.', expectedIntent: 'BOOKING_INTENT', qualifies: true },
  { name: 'French information', message: 'Quels services proposez-vous ?', expectedIntent: 'UNKNOWN', qualifies: false },
  { name: 'French booking', message: 'Je veux réserver un rendez-vous vendredi après-midi.', expectedIntent: 'BOOKING_INTENT', qualifies: true },
  { name: 'Arabic purchase', message: 'أريد شراء هذه الخدمة غدا', expectedIntent: 'PURCHASE_INTENT', qualifies: true },
  { name: 'Darija booking', message: 'بغيت نحجز طوموبيل غدا', expectedIntent: 'BOOKING_INTENT', qualifies: true },
  { name: 'Darija Latin purchase', message: 'bghit tomobil 5 iyam mn Monday', expectedIntent: 'PURCHASE_INTENT', qualifies: true },
  { name: 'Mixed booking', message: 'Je veux book موعد Friday', expectedIntent: 'BOOKING_INTENT', qualifies: true },
  { name: 'Complaint', message: 'This service is terrible. I have a complaint.', expectedIntent: 'COMPLAINT', qualifies: false },
  { name: 'Support', message: 'I need help because it is not working.', expectedIntent: 'SUPPORT_REQUEST', qualifies: false },
  { name: 'Human request', message: 'I want to speak to a person.', expectedIntent: 'HUMAN_REQUEST', qualifies: false },
] as const;
