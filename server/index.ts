// ============================================================================
// Local Server Entry Point with Startup Fail-Closed Safety Validation
// ============================================================================

import app from './app';
import { logger } from './utils/logger';
import { loadProviderConfig, validateProviderConfig, getRedactedConfigSummary } from './services/reminders/config';

const port = process.env.PORT || 3001;

// Startup fail-closed configuration validation
const providerConfig = loadProviderConfig();
const validation = validateProviderConfig(providerConfig);

if (!validation.valid) {
  logger.error('FATAL: Invalid messaging provider configuration detected on startup', {
    errors: validation.errors,
    config: getRedactedConfigSummary(providerConfig)
  });

  if (process.env.NODE_ENV === 'production') {
    logger.error('CRITICAL: Server refusing to start in production mode due to invalid provider configuration.');
    process.exit(1);
  }
} else {
  logger.info('Messaging provider configuration validated successfully', {
    config: getRedactedConfigSummary(providerConfig)
  });
}

app.listen(port, () => {
  logger.info(`FITFUSION Backend API Server running on port ${port}`);
});
