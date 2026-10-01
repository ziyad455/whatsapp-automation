import { MastraAuthBetterAuth } from '@mastra/auth-better-auth';
import { auth } from './auth';
import { readBoundedBody, RequestBodyTooLargeError } from '../http/bounded-body';
import { enforceRateLimit } from '../http/rate-limit';
import { ApplicationError } from '../http/errors';

class ApplicationAuth extends MastraAuthBetterAuth {
  override async handleAuthRequest(request: Request): Promise<Response> {
    try {
      enforceRateLimit('public:auth', 120);
      if (decodeURI(new URL(request.url).pathname) === '/auth/api/sign-in/email') {
        enforceRateLimit('public:sign-in', 20);
      }
      const bounded = request.body
        ? new Request(request, { body: (await readBoundedBody(request)).buffer as ArrayBuffer })
        : request;
      return await super.handleAuthRequest(bounded);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError || error instanceof ApplicationError) {
        const status = error instanceof RequestBodyTooLargeError ? 413 : error.status;
        return Response.json({ error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'RATE_LIMITED', message: error.message } }, {
          status, headers: { 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '60' } : {}) },
        });
      }
      throw error;
    }
  }
}

export const mastraAuth = new ApplicationAuth({
  auth,
  signUpEnabled: false,
  public: ['/health', '/ready', '/version', '/auth/api/*', '/webhooks/whatsapp'],
  protected: ['/api/*'],
});
