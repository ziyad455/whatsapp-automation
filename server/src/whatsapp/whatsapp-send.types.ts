export interface WhatsAppSendResult {
  readonly provider: 'WHATSAPP';
  readonly accepted: true;
  readonly externalMessageId: string;
}

export type WhatsAppSendErrorCode =
  | 'CONFIGURATION'
  | 'CONNECTION_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

export class WhatsAppSendError extends Error {
  readonly code: WhatsAppSendErrorCode;
  readonly retryable: boolean;
  readonly providerStatus?: number;

  constructor(options: {
    code: WhatsAppSendErrorCode;
    message: string;
    retryable: boolean;
    providerStatus?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'WhatsAppSendError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.providerStatus = options.providerStatus;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.providerStatus === undefined
        ? {}
        : { providerStatus: this.providerStatus }),
    };
  }
}

export interface WhatsAppTextTransport {
  sendText(input: {
    readonly phoneNumberId: string;
    readonly to: string;
    readonly text: string;
  }): Promise<WhatsAppSendResult>;
}

export interface WhatsAppTemplateReference {
  readonly name: string;
  readonly languageCode: string;
  readonly bodyParameters: readonly string[];
}

export interface WhatsAppTemplateTransport {
  sendTemplate(input: {
    readonly phoneNumberId: string;
    readonly to: string;
    readonly template: WhatsAppTemplateReference;
  }): Promise<WhatsAppSendResult>;
}

export type WhatsAppTransport = WhatsAppTextTransport & WhatsAppTemplateTransport;
