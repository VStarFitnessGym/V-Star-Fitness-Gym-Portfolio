// ============================================================================
// Stage 5B: WhatsApp Business Platform Cloud API Adapter
// Conforms to official Meta Graph API v21.0 specifications
// Supports dependency-injected HTTP transport for zero-network automated testing
// ============================================================================

import {
  IProviderAdapter,
  OutboundMessageRequest,
  ProviderSubmissionResult,
  IHttpClient,
  normalizeE164Phone,
  maskPhone,
  maskAuthHeader
} from '../providerTypes';
import { WhatsAppConfig } from '../config';

/**
 * Default Fetch-based HTTP Client with bounded request timeouts
 */
export class DefaultFetchHttpClient implements IHttpClient {
  async post(url: string, options: { headers?: Record<string, string>; body?: string; timeoutMs?: number; signal?: AbortSignal }) {
    // Defense-in-depth safety guard: prohibit live network sockets in test environment
    if (process.env.NODE_ENV === 'test' && !process.env.ALLOW_LIVE_CALLS_IN_TEST) {
      throw new Error(`[SAFETY_GUARD] Live outbound network requests strictly prohibited in test environment: POST ${url}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 10000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: options.headers,
        body: options.body,
        signal: options.signal || controller.signal
      });

      const bodyText = await response.text();
      clearTimeout(timeoutId);

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyText,
        json: async <T = any>() => JSON.parse(bodyText) as T
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

export class WhatsAppCloudApiAdapter implements IProviderAdapter {
  public readonly name = 'meta_whatsapp';
  public readonly channel = 'whatsapp';

  private config: WhatsAppConfig;
  private httpClient: IHttpClient;

  constructor(config: WhatsAppConfig, httpClient?: IHttpClient) {
    this.config = config;
    this.httpClient = httpClient || new DefaultFetchHttpClient();
  }

  async send(request: OutboundMessageRequest): Promise<ProviderSubmissionResult> {
    // 1. Validate and Normalize Recipient Phone Number
    const phoneValidation = normalizeE164Phone(request.recipientPhone);
    if (!phoneValidation.valid || !phoneValidation.normalized) {
      return {
        outcome: 'permanent_rejection',
        provider: this.name,
        errorCode: 'INVALID_RECIPIENT_PHONE',
        errorMessage: phoneValidation.error || 'Recipient phone failed E.164 normalization'
      };
    }

    // Meta API requires phone number in international format without the leading '+'
    const recipientDigitsOnly = phoneValidation.normalized.replace(/^\+/, '');

    // 2. Format Template Components according to Meta Cloud API specification
    const templateName = request.template?.name || this.config.templateName;
    const languageCode = request.template?.language || 'en';
    const parameterEntries = Object.entries(request.template?.parameters || {});

    const bodyParameters = parameterEntries.map(([_, val]) => ({
      type: 'text',
      text: String(val)
    }));

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientDigitsOnly,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: 'body',
            parameters: bodyParameters
          }
        ]
      }
    };

    const apiUrl = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json'
    };

    // 3. Dispatch via Dependency-Injected HTTP Client
    try {
      const response = await this.httpClient.post(apiUrl, {
        headers,
        body: JSON.stringify(payload),
        timeoutMs: this.config.requestTimeoutMs
      });

      let jsonBody: any = {};
      try {
        jsonBody = await response.json();
      } catch {
        jsonBody = { raw: response.bodyText };
      }

      // 4. Handle HTTP Response Codes
      // A. HTTP 200 OK — Submission Accepted by Meta Gateway
      if (response.status === 200) {
        const messageId = jsonBody?.messages?.[0]?.id;
        if (!messageId) {
          return {
            outcome: 'ambiguous_timeout',
            provider: this.name,
            errorCode: 'MISSING_PROVIDER_MESSAGE_ID',
            errorMessage: 'Meta returned HTTP 200 but response lacked message ID',
            rawResponse: jsonBody
          };
        }

        return {
          outcome: 'accepted',
          provider: this.name,
          providerMessageId: messageId,
          rawResponse: jsonBody
        };
      }

      // B. HTTP 429 Too Many Requests / Rate Limiting (Retryable)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
        return {
          outcome: 'retryable_rejection',
          provider: this.name,
          errorCode: 'META_RATE_LIMIT_EXCEEDED',
          errorMessage: jsonBody?.error?.message || 'Meta API rate limit exceeded',
          retryAfterSeconds: isNaN(retryAfter) ? 60 : retryAfter,
          rawResponse: jsonBody
        };
      }

      // C. HTTP 5xx Server Errors (Transient / Gateway Error)
      if (response.status >= 500) {
        return {
          outcome: 'retryable_rejection',
          provider: this.name,
          errorCode: `META_SERVER_ERROR_${response.status}`,
          errorMessage: jsonBody?.error?.message || `Meta Graph API returned HTTP ${response.status}`,
          rawResponse: jsonBody
        };
      }

      // D. HTTP 4xx Client Errors (Permanent Rejections)
      const metaErrorCode = jsonBody?.error?.code;
      const metaErrorSubcode = jsonBody?.error?.error_subcode;
      const metaErrorMessage = jsonBody?.error?.message || `Meta API rejected request with status ${response.status}`;

      // Error code 80007 / 130429 indicates temporary throttling
      if (metaErrorCode === 80007 || metaErrorCode === 130429) {
        return {
          outcome: 'retryable_rejection',
          provider: this.name,
          errorCode: `META_THROTTLE_${metaErrorCode}`,
          errorMessage: metaErrorMessage,
          rawResponse: jsonBody
        };
      }

      // Verified Meta error codes confirming permanent recipient delivery failure:
      //  - 131030: Recipient phone number not in allowed list / not on WhatsApp
      //  - 131026: Message undeliverable - recipient phone number not on WhatsApp
      //  - 131047: Re-engagement window expired / phone unreachable
      //  - 131051: Unsupported phone number
      //  - 131052: Destination number blocked
      //  - 131053: Recipient cannot receive message
      const isPermanentDeliveryFailure = [131030, 131026, 131047, 131051, 131052, 131053].includes(Number(metaErrorCode));

      // All other 4xx errors are permanent (e.g. invalid recipient, template non-existent, unallocated number)
      return {
        outcome: 'permanent_rejection',
        provider: this.name,
        errorCode: `META_REJECTED_${metaErrorCode || response.status}`,
        errorMessage: metaErrorMessage,
        isPermanentDeliveryFailure,
        rawResponse: jsonBody
      };
    } catch (err: any) {
      // 5. Handle Network Exceptions and Timeouts
      // Transport failure after request dispatch MUST be classified as ambiguous_timeout
      // (The socket dropped, but the gateway may have accepted the message upstream!)
      return {
        outcome: 'ambiguous_timeout',
        provider: this.name,
        errorCode: err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED',
        errorMessage: err?.message ? err.message.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]') : 'Network transport error during dispatch'
      };
    }
  }
}
