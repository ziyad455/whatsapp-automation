import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_PERMISSIONS, requireBusinessPermission } from '../src/tenancy/business-permissions';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { createTenantBusinessProfileService } from '../src/business-configuration/tenant-business-profile.service';
import { createTenantOpeningHoursService } from '../src/business-configuration/tenant-opening-hours.service';
import { createTenantBusinessRuleService } from '../src/business-configuration/tenant-business-rule.service';
import { createTenantBusinessCatalogService } from '../src/business-data/tenant-business-catalog.service';
import { createTenantBusinessSchemaService } from '../src/business-data/tenant-business-schema.service';
import { applyBusinessTemplate } from '../src/business-data/business-type-templates';
import { createTenantCampaignService, type CampaignInput } from '../src/reactivation/campaign.service';
import { createTenantFollowUpService } from '../src/follow-ups/follow-up.service';
import type { FollowUpSettings } from '../src/follow-ups/follow-up-policy';

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  business: { findUnique: vi.fn() },
  campaign: { create: vi.fn(), findFirst: vi.fn() },
  campaignRecipient: { count: vi.fn() },
}));
vi.mock('../src/db/prisma', () => ({ prisma: database }));

const staff: TenantContext = {
  businessId: 'business-a', userId: 'user-a', membershipId: 'membership-a', role: 'STAFF',
};

describe('business permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows owners every declared action and preserves staff operational access', () => {
    for (const permission of Object.keys(BUSINESS_PERMISSIONS) as Array<keyof typeof BUSINESS_PERMISSIONS>) {
      expect(() => requireBusinessPermission({ ...staff, role: 'OWNER' }, permission)).not.toThrow();
      const roles: readonly string[] = BUSINESS_PERMISSIONS[permission];
      if (roles.includes('STAFF')) {
        expect(() => requireBusinessPermission(staff, permission)).not.toThrow();
      } else {
        expect(() => requireBusinessPermission(staff, permission)).toThrowError(
          expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
        );
      }
    }
  });

  it('denies staff direct service calls before validation, database access, or provider calls', async () => {
    const verifyTemplate = vi.fn();
    const campaign = createTenantCampaignService(staff, { verifyTemplate });
    const actions = [
      () => createTenantBusinessProfileService(staff).update({} as never),
      () => createTenantOpeningHoursService(staff).replaceWeek([]),
      () => createTenantBusinessRuleService(staff).create({} as never),
      () => createTenantBusinessRuleService(staff).update('foreign-rule', {}),
      () => createTenantBusinessCatalogService(staff).create({} as never),
      () => createTenantBusinessSchemaService(staff).addFieldDefinition({} as never),
      () => createTenantBusinessSchemaService(staff).updateFieldDefinition('foreign-field', {}),
      () => applyBusinessTemplate(staff),
      () => createTenantFollowUpService(staff).updateSettings({} as FollowUpSettings),
      () => campaign.create({} as CampaignInput),
      () => campaign.prepare('foreign-campaign'),
      () => campaign.launch('foreign-campaign'),
      () => campaign.cancel('foreign-campaign'),
    ];
    for (const action of actions) {
      await expect(action()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.business.findUnique).not.toHaveBeenCalled();
    expect(database.campaign.create).not.toHaveBeenCalled();
    expect(database.campaign.findFirst).not.toHaveBeenCalled();
    expect(database.campaignRecipient.count).not.toHaveBeenCalled();
    expect(verifyTemplate).not.toHaveBeenCalled();
  });

  it('rejects unrecognized roles at runtime', () => {
    expect(() => requireBusinessPermission({ ...staff, role: 'ADMIN' } as unknown as TenantContext,
      'CAMPAIGN_LAUNCH')).toThrowError(expect.objectContaining({ status: 403 }));
  });
});
