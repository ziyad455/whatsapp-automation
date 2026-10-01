import { Prisma } from '../generated/prisma/client';
import type { AiUsageOperation, AiUsageStatus } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import { applicationLogger } from '../http/logger';
import type { TenantScope } from '../tenancy/tenant-context';
import type { BusinessReportingRange } from './reporting-range';

export interface AiTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ModelPricing {
  readonly inputUsdPerMillionTokens: string;
  readonly outputUsdPerMillionTokens: string;
}

export type ModelPricingCatalog = Readonly<Record<string, ModelPricing>>;

export const AI_MODEL_PRICING: ModelPricingCatalog = Object.freeze({});

const priceKey = (provider: string, model: string) => `${provider}:${model}`;

const tokenCount = (value: number | undefined): number | null =>
  Number.isSafeInteger(value) && value! >= 0 ? value! : null;

export const estimateAiCostUsd = (
  provider: string,
  model: string,
  usage: AiTokenUsage,
  catalog: ModelPricingCatalog = AI_MODEL_PRICING,
): Prisma.Decimal | null => {
  const pricing = catalog[priceKey(provider, model)];
  const inputTokens = tokenCount(usage.inputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  if (!pricing || inputTokens === null || outputTokens === null) return null;

  return new Prisma.Decimal(pricing.inputUsdPerMillionTokens)
    .mul(inputTokens)
    .plus(new Prisma.Decimal(pricing.outputUsdPerMillionTokens).mul(outputTokens))
    .div(1_000_000)
    .toDecimalPlaces(8);
};

export interface RecordAiUsageInput {
  readonly tenant: TenantScope;
  readonly conversationId?: string;
  readonly leadId?: string;
  readonly operation: AiUsageOperation;
  readonly provider: string;
  readonly model: string;
  readonly status: AiUsageStatus;
  readonly usage?: AiTokenUsage;
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly occurredAt?: Date;
}

export const recordAiUsage = async (input: RecordAiUsageInput) => {
  const usage = input.usage ?? {};
  const estimatedCostUsd = estimateAiCostUsd(
    input.provider,
    input.model,
    usage,
  );
  return prisma.aiUsageRecord.create({
    data: {
      businessId: input.tenant.businessId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      status: input.status,
      inputTokens: tokenCount(usage.inputTokens),
      outputTokens: tokenCount(usage.outputTokens),
      totalTokens: tokenCount(usage.totalTokens),
      estimatedCostUsd,
      currency: estimatedCostUsd ? 'USD' : null,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      errorCode: input.errorCode?.slice(0, 100) ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  });
};

export const recordAiUsageSafely = async (input: RecordAiUsageInput): Promise<void> => {
  try {
    await recordAiUsage(input);
  } catch (error) {
    applicationLogger.warn('AI usage persistence failed without changing the AI result', {
      businessId: input.tenant.businessId,
      operation: input.operation,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

export const getTenantAiUsageMetrics = async (
  tenant: TenantScope,
  range: BusinessReportingRange,
) => {
  const records = await prisma.aiUsageRecord.findMany({
    where: {
      businessId: tenant.businessId,
      occurredAt: { gte: range.start, lte: range.end },
    },
    select: {
      operation: true,
      provider: true,
      model: true,
      status: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      durationMs: true,
    },
  });

  const total = records.reduce((summary, record) => ({
    requests: summary.requests + 1,
    failures: summary.failures + (record.status === 'FAILED' ? 1 : 0),
    inputTokens: summary.inputTokens + (record.inputTokens ?? 0),
    outputTokens: summary.outputTokens + (record.outputTokens ?? 0),
    totalTokens: summary.totalTokens + (record.totalTokens ?? 0),
    durationMs: summary.durationMs + record.durationMs,
  }), {
    requests: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  });

  return {
    range: {
      key: range.key,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      timeZone: range.timeZone,
    },
    ...total,
    estimatedCostUsd: records.length > 0
      && records.every(record => record.estimatedCostUsd !== null)
      ? records.reduce(
          (cost, record) => cost.plus(record.estimatedCostUsd!),
          new Prisma.Decimal(0),
        ).toFixed(8)
      : null,
    averageLatencyMs: total.requests === 0
      ? null
      : Math.round(total.durationMs / total.requests),
    breakdown: Object.values(records.reduce<Record<string, {
      operation: AiUsageOperation;
      provider: string;
      model: string;
      requests: number;
      totalTokens: number;
    }>>((groups, record) => {
      const key = `${record.operation}:${record.provider}:${record.model}`;
      const current = groups[key] ?? {
        operation: record.operation,
        provider: record.provider,
        model: record.model,
        requests: 0,
        totalTokens: 0,
      };
      groups[key] = {
        ...current,
        requests: current.requests + 1,
        totalTokens: current.totalTokens + (record.totalTokens ?? 0),
      };
      return groups;
    }, {})),
  };
};
