// ============================================================================
// Application Mode Configuration (Stage 4)
// Manages Demo Mode (Offline Synthetic Data) vs Live Mode (Backend API)
// ============================================================================

export type AppMode = 'demo' | 'live';

export interface AppModeConfig {
  mode: AppMode;
  apiBaseUrl: string;
  isDemo: boolean;
  isLive: boolean;
}

function getEnvVar(name: string): string | undefined {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env[name];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}

/**
 * Determine initial application mode.
 * Defaults strictly to 'demo' unless VITE_APP_MODE is explicitly set to 'live'.
 * This guarantees zero accidental live connections without configuration.
 */
export function getInitialAppMode(): AppMode {
  const envMode = getEnvVar('VITE_APP_MODE');
  if (envMode === 'live') {
    return 'live';
  }
  return 'demo';
}

export function getAppModeConfig(currentMode: AppMode): AppModeConfig {
  return {
    mode: currentMode,
    apiBaseUrl: getEnvVar('VITE_API_BASE_URL') || '/api',
    isDemo: currentMode === 'demo',
    isLive: currentMode === 'live'
  };
}
