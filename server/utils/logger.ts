// ============================================================================
// Privacy-Conscious Structured Logger
// Masks phone numbers, emails, and redacts secrets/tokens
// ============================================================================

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const clean = phone.trim();
  if (clean.length < 8) return '***';
  return clean.slice(0, 6) + '*****' + clean.slice(-2);
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***@***.***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name[0]}***`;
  return `${maskedName}@${domain}`;
}

export function sanitizeLogData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeLogData);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Redact credentials and sensitive tokens completely
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('key')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (lowerKey.includes('phone')) {
      sanitized[key] = typeof value === 'string' ? maskPhone(value) : value;
    } else if (lowerKey.includes('email')) {
      sanitized[key] = typeof value === 'string' ? maskEmail(value) : value;
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export const logger = {
  info(message: string, context?: Record<string, any>) {
    const output = {
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...(context ? sanitizeLogData(context) : {})
    };
    console.log(JSON.stringify(output));
  },

  warn(message: string, context?: Record<string, any>) {
    const output = {
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      ...(context ? sanitizeLogData(context) : {})
    };
    console.warn(JSON.stringify(output));
  },

  error(message: string, error?: Error | any, context?: Record<string, any>) {
    const output = {
      level: 'error',
      message,
      error_name: error?.name || 'Error',
      error_message: error?.message || String(error),
      timestamp: new Date().toISOString(),
      ...(context ? sanitizeLogData(context) : {})
    };
    console.error(JSON.stringify(output));
  }
};
