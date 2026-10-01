export type ApplicationErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'TENANT_SELECTION_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR';

type ApplicationErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly status: ApplicationErrorStatus;
  readonly details?: unknown;

  constructor(options: {
    code: ApplicationErrorCode;
    message: string;
    status: ApplicationErrorStatus;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export const toErrorResponse = (
  error: Error,
  requestId: string,
): {
  status: ApplicationErrorStatus;
  body: {
    error: {
      code: ApplicationErrorCode;
      message: string;
      details?: unknown;
    };
    requestId: string;
  };
} => {
  if (error instanceof ApplicationError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The server could not complete the request.',
      },
      requestId,
    },
  };
};
