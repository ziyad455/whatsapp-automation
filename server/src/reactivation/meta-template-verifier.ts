import { z } from 'zod';
import { env } from '../config/env';

const templateResponseSchema = z.object({
  data: z.array(z.object({
    name: z.string(),
    language: z.string(),
    status: z.string(),
    category: z.string(),
  }).passthrough()),
}).passthrough();

export interface TemplateVerificationResult {
  readonly approved: boolean;
  readonly category: string | null;
  readonly reason: 'APPROVED' | 'NOT_FOUND' | 'NOT_APPROVED' | 'NOT_MARKETING';
}

export type VerifyCampaignTemplate = (input: {
  readonly whatsappBusinessAccountId: string;
  readonly name: string;
  readonly language: string;
}) => Promise<TemplateVerificationResult>;

export const verifyMetaCampaignTemplate: VerifyCampaignTemplate = async input => {
  if (!env.META_WHATSAPP_ACCESS_TOKEN || !env.META_WHATSAPP_API_VERSION) {
    return { approved: false, category: null, reason: 'NOT_FOUND' };
  }
  const url = new URL(
    `https://graph.facebook.com/${env.META_WHATSAPP_API_VERSION}/${input.whatsappBusinessAccountId}/message_templates`,
  );
  url.searchParams.set('name', input.name);
  url.searchParams.set('fields', 'name,language,status,category');
  url.searchParams.set('limit', '100');
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Meta template verification failed with HTTP ${response.status}.`);
  }
  const parsed = templateResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Meta returned an invalid template verification response.');
  const template = parsed.data.data.find(item =>
    item.name === input.name && item.language === input.language);
  if (!template) return { approved: false, category: null, reason: 'NOT_FOUND' };
  if (template.status !== 'APPROVED') {
    return { approved: false, category: template.category, reason: 'NOT_APPROVED' };
  }
  if (template.category !== 'MARKETING') {
    return { approved: false, category: template.category, reason: 'NOT_MARKETING' };
  }
  return { approved: true, category: template.category, reason: 'APPROVED' };
};
