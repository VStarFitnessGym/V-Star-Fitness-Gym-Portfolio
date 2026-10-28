// ============================================================================
// Stage 5B: Provider Configuration & Startup Safety Validation
// Validates environment variables and enforces production security guards
// ============================================================================

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  apiVersion: string;
  templateName: string;
  enabled: boolean;
  requestTimeoutMs: number;
}

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  enabled: boolean;
  requestTimeoutMs: number;
}

export interface ReminderProviderConfig {
  environment: string;
  whatsapp: WhatsAppConfig;
  sms: SmsConfig;
  allowMockInProduction: boolean;
  disableWebhookVerification: boolean;
}

/**
 * Loads provider configuration from environment variables with safe defaults
 */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ReminderProviderConfig {
  const environment = env.NODE_ENV || 'development';

  return {
    environment,
    whatsapp: {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
      templateName: env.WHATSAPP_TEMPLATE_NAME || 'membership_expiry_reminder',
      enabled: env.WHATSAPP_ENABLED === 'true',
      requestTimeoutMs: parseInt(env.WHATSAPP_TIMEOUT_MS || '10000', 10)
    },
    sms: {
      accountSid: env.SMS_ACCOUNT_SID || '',
      authToken: env.SMS_AUTH_TOKEN || '',
      fromNumber: env.SMS_FROM_NUMBER || '',
      enabled: env.SMS_ENABLED === 'true',
      requestTimeoutMs: parseInt(env.SMS_TIMEOUT_MS || '10000', 10)
    },
    allowMockInProduction: env.ALLOW_MOCK_IN_PROD === 'true',
    disableWebhookVerification: env.DISABLE_WEBHOOK_VERIFICATION === 'true'
  };
}

/**
 * Validates configuration and rejects unsafe production combinations
 */
export function validateProviderConfig(config: ReminderProviderConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const isProduction = config.environment === 'production';

  // 1. WhatsApp Configuration Validation
  if (config.whatsapp.enabled) {
    if (!config.whatsapp.phoneNumberId) {
      errors.push('WHATSAPP_PHONE_NUMBER_ID is required when WhatsApp is enabled.');
    }
    if (!config.whatsapp.accessToken) {
      errors.push('WHATSAPP_ACCESS_TOKEN is required when WhatsApp is enabled.');
    }
    if (!config.whatsapp.appSecret) {
      errors.push('WHATSAPP_APP_SECRET is required when WhatsApp is enabled.');
    }
    if (!config.whatsapp.verifyToken) {
      errors.push('WHATSAPP_VERIFY_TOKEN is required when WhatsApp is enabled.');
    }
  }

  // 2. SMS Configuration Validation
  if (config.sms.enabled) {
    if (!config.sms.accountSid) {
      errors.push('SMS_ACCOUNT_SID is required when SMS is enabled.');
    }
    if (!config.sms.authToken) {
      errors.push('SMS_AUTH_TOKEN is required when SMS is enabled.');
    }
    if (!config.sms.fromNumber) {
      errors.push('SMS_FROM_NUMBER is required when SMS is enabled.');
    }
  }

  // 3. Strict Production Invariants
  if (isProduction) {
    if (config.disableWebhookVerification) {
      errors.push('DISABLE_WEBHOOK_VERIFICATION cannot be true in production.');
    }
    if (!config.whatsapp.enabled && !config.sms.enabled && !config.allowMockInProduction) {
      errors.push('Production cannot run without at least one live provider enabled unless ALLOW_MOCK_IN_PROD is explicitly set.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Produces a safe, redacted representation of configuration for operational logging
 */
export function getRedactedConfigSummary(config: ReminderProviderConfig): Record<string, any> {
  return {
    environment: config.environment,
    whatsapp: {
      enabled: config.whatsapp.enabled,
      phoneNumberId: config.whatsapp.phoneNumberId ? `...${config.whatsapp.phoneNumberId.slice(-4)}` : '[NONE]',
      accessToken: config.whatsapp.accessToken ? '[CONFIGURED - REDACTED]' : '[NONE]',
      appSecret: config.whatsapp.appSecret ? '[CONFIGURED - REDACTED]' : '[NONE]',
      verifyToken: config.whatsapp.verifyToken ? '[CONFIGURED - REDACTED]' : '[NONE]',
      apiVersion: config.whatsapp.apiVersion,
      templateName: config.whatsapp.templateName,
      timeoutMs: config.whatsapp.requestTimeoutMs
    },
    sms: {
      enabled: config.sms.enabled,
      accountSid: config.sms.accountSid ? `...${config.sms.accountSid.slice(-4)}` : '[NONE]',
      authToken: config.sms.authToken ? '[CONFIGURED - REDACTED]' : '[NONE]',
      fromNumber: config.sms.fromNumber ? `...${config.sms.fromNumber.slice(-4)}` : '[NONE]',
      timeoutMs: config.sms.requestTimeoutMs
    },
    allowMockInProduction: config.allowMockInProduction,
    disableWebhookVerification: config.disableWebhookVerification
  };
}
