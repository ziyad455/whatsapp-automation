import { closeDatabaseConnection, prisma } from '../src/db/prisma';

// Operator CLI, not a tenant HTTP endpoint. Emit counts only, never customer data.
try {
  const since = new Date(Date.now() - 15 * 60_000);
  const [blockedConnections, staleInbound, staleOutbound, failedInbound, failedFollowUps, failedCampaignRecipients] = await Promise.all([
    prisma.whatsAppConnection.count({ where: { outboundBlockedAt: { not: null } } }),
    prisma.whatsAppMessage.count({ where: { direction: 'INBOUND', processingStatus: { in: ['RECEIVED', 'PROCESSING'] }, updatedAt: { lt: since } } }),
    prisma.whatsAppMessage.count({ where: { direction: 'OUTBOUND', deliveryStatus: 'PENDING', createdAt: { lt: since } } }),
    prisma.whatsAppMessage.count({ where: { direction: 'INBOUND', processingStatus: 'FAILED', processingFailedAt: { gte: since } } }),
    prisma.followUp.count({ where: { status: 'FAILED', failedAt: { gte: since } } }),
    prisma.campaignRecipient.count({ where: { status: 'FAILED', failedAt: { gte: since } } }),
  ]);
  const attentionRequired = blockedConnections > 0 || staleInbound > 0 || staleOutbound > 0 ||
    failedInbound + failedFollowUps + failedCampaignRecipients >= 5;
  console.log(JSON.stringify({ event: 'operations.status', attentionRequired, blockedConnections,
    staleInbound, staleOutbound, failedInbound, failedFollowUps, failedCampaignRecipients }));
  if (attentionRequired) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: 'operations.status', error: 'DATABASE_UNAVAILABLE' }));
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
