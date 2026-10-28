// ============================================================================
// Stage 5B: SMS Provider Adapter (Replaceable Vendor Architecture)
// Standard REST implementation conforming to Twilio / Industry SMS standards
// Supports dependency-injected HTTP transport for zero-network automated testing
// ============================================================================

import {
  IProviderAdapter,
  OutboundMessageRequest,
  ProviderSubmissionResult,
  IHttpClient,
  normalizeE164Phone
} from '../providerTypes';
import { SmsConfig } from '../config';
import { DefaultFetchHttpClient } from './whatsappAdapter';

export interface ISmsProviderAdapter extends IProviderAdapter {
  readonly channel: 'sms';
}

export class TwilioSmsAdapter implements ISmsProviderAdapter {
  public readonly name = 'twilio_sms';
  public readonly channel = 'sms' as const;

  private config: SmsConfig;
  private httpClient: IHttpClient;

  constructor(config: SmsConfig, httpClient?: IHttpClient) {
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

    // 2. Prepare Form-Encoded SMS Payload (Standard Twilio REST API Format)
    const bodyText = request.bodyText || `FITFUSION: Your gym membership expires on ${request.template.parameters['expiry_date'] || 'soon'}. Please renew to maintain uninterrupted access.`;

    const formParams = new URLSearchParams();
    formParams.append('To', phoneValidation.normalized);
    formParams.append('From', this.config.fromNumber);
    formParams.append('Body', bodyText);

    const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const basicAuth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const headers: Record<string, string> = {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 3. Dispatch via Dependency-Injected HTTP Client
    try {
      const response = await this.httpClient.post(apiUrl, {
        headers,
        body: formParams.toString(),
        timeoutMs: this.config.requestTimeoutMs
      });

      let jsonBody: any = {};
      try {
        jsonBody = await response.json();
      } catch {
        jsonBody = { raw: response.bodyText };
      }

      // 4. Handle HTTP Response Codes
      // A. HTTP 201 Created — Submission Accepted by SMS Gateway
      if (response.status === 201 || response.status === 200) {
        const messageSid = jsonBody?.sid;
        if (!messageSid) {
          return {
            outcome: 'ambiguous_timeout',
            provider: this.name,
            errorCode: 'MISSING_MESSAGE_SID',
            errorMessage: 'SMS gateway returned success but lacked message SID',
            rawResponse: jsonBody
          };
        }

        return {
          outcome: 'accepted',
          provider: this.name,
          providerMessageId: messageSid,
          rawResponse: jsonBody
        };
      }

      const twilioCode = jsonBody?.code;
      const twilioMessage = jsonBody?.message || `SMS provider rejected request with status ${response.status}`;

      // B. HTTP 429 Too Many Requests / Twilio Code 20429 (Retryable)
      if (response.status === 429 || twilioCode === 20429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
        return {
          outcome: 'retryable_rejection',
          provider: this.name,
          errorCode: 'SMS_RATE_LIMIT_EXCEEDED',
          errorMessage: twilioMessage || 'SMS provider rate limit exceeded',
          retryAfterSeconds: isNaN(retryAfter) ? 60 : retryAfter,
          rawResponse: jsonBody
        };
      }

      // C. HTTP 5xx Server Errors (Retryable)
      if (response.status >= 500) {
        return {
          outcome: 'retryable_rejection',
          provider: this.name,
          errorCode: `SMS_SERVER_ERROR_${response.status}`,
          errorMessage: jsonBody?.message || `SMS provider returned HTTP ${response.status}`,
          rawResponse: jsonBody
        };
      }

      // D. HTTP 4xx Client Errors (Permanent Rejections)
      // Known permanent rejection codes:
      // 21211: Invalid 'To' phone number
      // 21614: 'To' number is not mobile / cannot receive SMS
      // 21408: Permission to send an SMS to this region has not been enabled
      return {
        outcome: 'permanent_rejection',
        provider: this.name,
        errorCode: `TWILIO_${twilioCode || response.status}`,
        errorMessage: twilioMessage,
        rawResponse: jsonBody
      };
    } catch (err: any) {
      // 5. Handle Network Exceptions and Timeouts
      return {
        outcome: 'ambiguous_timeout',
        provider: this.name,
        errorCode: err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED',
        errorMessage: err?.message ? err.message.replace(/Basic\s+[A-Za-z0-9_\-\.\=\+]+/gi, 'Basic [REDACTED]') : 'Network transport error during SMS dispatch'
      };
    }
  }
}
