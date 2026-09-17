import { env } from '../src/config/env';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';

const businessIdArgument = process.argv.find(argument =>
  argument.startsWith('--business-id='));
const businessId = businessIdArgument?.slice('--business-id='.length).trim();

if (!businessId) {
  throw new Error('Pass the target business as --business-id=<uuid>.');
}

if (!env.META_WHATSAPP_PHONE_NUMBER_ID || !env.META_WHATSAPP_BUSINESS_ACCOUNT_ID) {
  throw new Error(
    'META_WHATSAPP_PHONE_NUMBER_ID and META_WHATSAPP_BUSINESS_ACCOUNT_ID are required.',
  );
}

try {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true },
  });
  if (!business) throw new Error('The selected business does not exist.');

  const existing = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID },
  });
  if (existing && existing.businessId !== business.id) {
    throw new Error('That WhatsApp phone number is already assigned to another business.');
  }

  const connection = existing
    ? await prisma.whatsAppConnection.update({
      where: { id: existing.id },
      data: {
        whatsappBusinessAccountId: env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
        status: 'ACTIVE',
      },
    })
    : await prisma.whatsAppConnection.create({
      data: {
        businessId: business.id,
        phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
        whatsappBusinessAccountId: env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
      },
    });

  console.log(`WhatsApp connection ${connection.id} is active for ${business.name}.`);
} finally {
  await closeDatabaseConnection();
}
