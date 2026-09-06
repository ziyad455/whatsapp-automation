import { z } from 'zod';
import type { TenantContext } from '../tenancy/tenant-context';

export const HISTORY_MESSAGE_LIMIT = 12;
export const HISTORY_CHARACTER_LIMIT = 12000;
export const MESSAGE_CHARACTER_LIMIT = 4000;

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MESSAGE_CHARACTER_LIMIT),
}).strict();
export type ConversationMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string };

export interface ConversationHistory {
  readonly businessId: string;
  readonly messages: readonly ConversationMessage[];
}

// Server-supplied, already-authorized history only. No system/tool messages or stored memory.
export const buildConversationMessages = (
  tenant: TenantContext,
  message: string,
  history?: ConversationHistory,
): ConversationMessage[] => {
  if (history && history.businessId !== tenant.businessId) {
    throw new Error('Conversation history does not belong to the authorized business.');
  }
  const current = conversationMessageSchema.parse({ role: 'user', content: message });
  const recent: ConversationMessage[] = [];
  let characters = 0;
  const tail = history?.messages.slice(-HISTORY_MESSAGE_LIMIT) ?? [];
  for (let index = tail.length - 1; index >= 0; index--) {
    const item = conversationMessageSchema.parse(tail[index]);
    if (characters + item.content.length > HISTORY_CHARACTER_LIMIT) break;
    characters += item.content.length;
    recent.unshift(item);
  }
  // Never leave a leading assistant answer whose preceding question was dropped.
  while (recent[0]?.role === 'assistant') recent.shift();
  return [...recent, current];
};
