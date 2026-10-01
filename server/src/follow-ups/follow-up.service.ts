import { Prisma, type FollowUp } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext, TenantScope } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { followUpSettingsSchema, type FollowUpSettings } from './follow-up-policy';

export const businessFollowUpSettings = (business: FollowUpSettings): FollowUpSettings =>
  followUpSettingsSchema.parse({
    followUpsEnabled: business.followUpsEnabled,
    initialFollowUpDelayMinutes: business.initialFollowUpDelayMinutes,
    followUpWindowStartMinutes: business.followUpWindowStartMinutes,
    followUpWindowEndMinutes: business.followUpWindowEndMinutes,
    maxFollowUpsPerLead: business.maxFollowUpsPerLead,
    minimumFollowUpIntervalMinutes: business.minimumFollowUpIntervalMinutes,
  });

const followUpText = (name: string, language: string): string => {
  if (language === 'fr')
    return `Bonjour, c'est ${name}. Je reviens vers vous au sujet de votre demande. Si vous avez encore besoin d'aide, répondez ici.`;
  if (language === 'ar')
    return `مرحبًا، معك ${name}. نتابع طلبك السابق. إذا كنت لا تزال بحاجة إلى المساعدة، يمكنك الرد هنا.`;
  return `Hi, this is ${name}. Just checking in about your request. If you still need help, reply here.`;
};

export const scheduleFollowUpForLead = async (
  tenant: TenantScope,
  leadId: string,
): Promise<FollowUp | null> => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId: tenant.businessId },
    include: {
      business: true,
      customer: true,
      conversation: true,
    },
  });
  if (!lead || !['NEW', 'INTERESTED', 'QUALIFIED'].includes(lead.status) ||
    lead.business.lifecycleStatus !== 'ACTIVE' || !lead.business.followUpsEnabled ||
    !lead.customer.followUpConsentAt ||
    (lead.customer.followUpOptedOutAt &&
      lead.customer.followUpOptedOutAt >= lead.customer.followUpConsentAt) ||
    lead.conversation.channel !== 'WHATSAPP' || lead.conversation.mode !== 'AI' ||
    lead.conversation.status !== 'OPEN') return null;

  const lastCustomerMessage = await prisma.conversationMessage.findFirst({
    where: {
      businessId: tenant.businessId,
      conversationId: lead.conversationId,
      senderType: 'CUSTOMER',
    },
    orderBy: [{ sequence: 'desc' }],
    select: { id: true, createdAt: true },
  });
  if (!lastCustomerMessage) return null;
  const latestIsLeadEvidence = await prisma.leadEvidence.findFirst({
    where: {
      businessId: tenant.businessId,
      leadId,
      messageId: lastCustomerMessage.id,
    },
    select: { id: true },
  });
  if (!latestIsLeadEvidence) return null;
  const sentCount = await prisma.followUp.count({
    where: { businessId: tenant.businessId, leadId, status: 'SENT' },
  });
  if (sentCount >= lead.business.maxFollowUpsPerLead) return null;

  const scheduledAt = new Date(lastCustomerMessage.createdAt.getTime() +
    lead.business.initialFollowUpDelayMinutes * 60_000);
  const content = followUpText(lead.business.name, lead.business.defaultLanguage);
  try {
    return await prisma.followUp.create({
      data: {
        businessId: tenant.businessId,
        leadId,
        conversationId: lead.conversationId,
        customerId: lead.customerId,
        scheduledAt,
        customerActivityAt: lastCustomerMessage.createdAt,
        content,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return prisma.followUp.findFirst({
        where: { businessId: tenant.businessId, leadId, type: 'INITIAL', status: 'PENDING' },
      });
    throw error;
  }
};

export const createTenantFollowUpService = (tenant: TenantContext) => ({
  settings: async () => {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: tenant.businessId } });
    return businessFollowUpSettings(business);
  },
  updateSettings: async (input: FollowUpSettings) => {
    requireBusinessPermission(tenant, 'FOLLOW_UP_CONFIGURATION_WRITE');
    const settings = followUpSettingsSchema.parse(input);
    return prisma.$transaction(async transaction => {
      const before = await transaction.business.findUniqueOrThrow({ where: { id: tenant.businessId } });
      const after = await transaction.business.update({
        where: { id: tenant.businessId },
        data: settings,
      });
      if (!settings.followUpsEnabled) {
        await transaction.followUp.updateMany({
          where: { businessId: tenant.businessId,
            status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'CANCELLED', reasonCode: 'FOLLOWUPS_DISABLED', cancelledAt: new Date() },
        });
      }
      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_PROFILE', targetId: tenant.businessId, action: 'UPDATE',
        before: businessFollowUpSettings(before), after: businessFollowUpSettings(after),
      });
      return businessFollowUpSettings(after);
    });
  },
  listForLead: (leadId: string) => prisma.followUp.findMany({
    where: { businessId: tenant.businessId, leadId, lead: { businessId: tenant.businessId } },
    orderBy: [{ createdAt: 'desc' }],
  }),
  recordConsent: async (leadId: string, consent: boolean) => {
    requireBusinessPermission(tenant, 'CUSTOMER_PREFERENCE_WRITE');
    const customerId = await prisma.$transaction(async transaction => {
      const lead = await transaction.lead.findFirst({
        where: { id: leadId, businessId: tenant.businessId },
        select: { customerId: true },
      });
      if (!lead) return null;
      await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
        hashtext(${tenant.businessId}), hashtext(${lead.customerId}))`;
      const customer = await transaction.customer.findFirst({
        where: { id: lead.customerId, businessId: tenant.businessId },
      });
      if (!customer) return null;
      const now = new Date();
      await transaction.customer.update({
        where: { businessId_id: { businessId: tenant.businessId, id: customer.id } },
        data: consent ? {
          followUpConsentAt: now,
          followUpOptedOutAt: null,
          followUpConsentRecordedById: tenant.userId,
        } : {
          followUpOptedOutAt: now,
        },
      });
      if (!consent) {
        await transaction.followUp.updateMany({
          where: { businessId: tenant.businessId, customerId: customer.id,
            status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'CANCELLED', cancelledAt: now, reasonCode: 'CUSTOMER_OPTED_OUT' },
        });
      }
      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'CUSTOMER', targetId: customer.id, action: 'UPDATE',
        before: { followUpConsentAt: customer.followUpConsentAt,
          followUpOptedOutAt: customer.followUpOptedOutAt },
        after: { followUpConsentAt: consent ? now : customer.followUpConsentAt,
          followUpOptedOutAt: consent ? null : now,
          recordedByUserId: tenant.userId },
      });
      return customer.id;
    });
    if (!customerId) return null;
    if (consent) await scheduleFollowUpForLead(tenant, leadId);
    return prisma.customer.findFirst({
      where: { id: customerId, businessId: tenant.businessId },
      select: { id: true, followUpConsentAt: true, followUpOptedOutAt: true },
    });
  },
});
