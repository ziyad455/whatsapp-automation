import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

type CreateAuthOptions = {
  signUpEnabled?: boolean;
};

const createAuthOptions = (signUpEnabled: boolean): BetterAuthOptions => ({
  appName: 'WhatsApp Automation',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth/api',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.DASHBOARD_URL],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 120,
    customRules: { '/sign-in/email': { window: 60, max: 20 } },
  },
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !signUpEnabled,
    autoSignIn: false,
  },
  advanced: {
    ipAddress: { ipAddressHeaders: [] },
    useSecureCookies: new URL(env.BETTER_AUTH_URL).protocol === 'https:',
    database: {
      generateId: 'uuid',
    },
  },
});

export const createAuth = ({ signUpEnabled = false }: CreateAuthOptions = {}) =>
  betterAuth(createAuthOptions(signUpEnabled));

export const auth = createAuth();
