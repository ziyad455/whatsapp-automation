import { createHmac, timingSafeEqual } from 'node:crypto';

const META_SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

export const verifyMetaWebhookSignature = (
  rawBody: Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean => {
  if (!signatureHeader) return false;

  const match = META_SIGNATURE_PATTERN.exec(signatureHeader);
  if (!match) return false;

  const received = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();

  return received.length === expected.length && timingSafeEqual(received, expected);
};
