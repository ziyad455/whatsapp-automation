import { MastraAuthBetterAuth } from '@mastra/auth-better-auth';
import { auth } from './auth';

export const mastraAuth = new MastraAuthBetterAuth({
  auth,
  signUpEnabled: false,
  public: ['/health', '/ready', '/version', '/auth/api/*'],
  protected: ['/api/*'],
});
