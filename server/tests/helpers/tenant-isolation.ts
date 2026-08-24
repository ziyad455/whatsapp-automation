import { expect } from 'vitest';

export const expectCrossTenantReadDenied = async <RecordType>(
  read: () => Promise<RecordType | null>,
): Promise<void> => {
  await expect(read()).resolves.toBeNull();
};

export const expectCrossTenantMutationDenied = async <RecordType>(
  mutate: () => Promise<boolean>,
  readTarget: () => Promise<RecordType | null>,
  expectedTarget: RecordType,
): Promise<void> => {
  await expect(mutate()).resolves.toBe(false);
  await expect(readTarget()).resolves.toEqual(expectedTarget);
};
