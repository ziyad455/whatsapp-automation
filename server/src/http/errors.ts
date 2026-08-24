export type ApplicationErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR';

type ApplicationErrorStatus = 400 | 404 | 500 | 503;

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly status: ApplicationErrorStatus;

  constructor(options: {
    code: ApplicationErrorCode;
    message: string;
    status: ApplicationErrorStatus;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = options.code;
    this.status = options.status;
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
