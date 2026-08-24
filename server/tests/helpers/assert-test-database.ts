const normalizeDatabaseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
};

export const assertIsolatedTestDatabase = (): void => {
  const runtimeDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  const testDatabaseUrl = normalizeDatabaseUrl(process.env.TEST_DATABASE_URL);

  if (
    process.env.NODE_ENV !== 'test' ||
    !runtimeDatabaseUrl ||
    !testDatabaseUrl ||
    runtimeDatabaseUrl !== testDatabaseUrl
  ) {
    throw new Error('Database tests require DATABASE_URL to match the isolated TEST_DATABASE_URL.');
  }
};
