// ============================================================================
// Database Client Abstraction
// Supports both PGlite (for deterministic local tests) and PostgreSQL / Supabase
// Backed by pg.Pool for production/staging connection pooling and session locking
// ============================================================================

import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { Pool, PoolClient, PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface ISessionClient extends IDatabaseClient {
  release(): Promise<void>;
  isReleased(): boolean;
}

export interface IDatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T>;
  isReady(): Promise<boolean>;
  acquireSessionClient(): Promise<ISessionClient>;
  close?(): Promise<void>;
}

/**
 * Safely redacts credentials from a database connection string for logs or error reporting.
 */
export function sanitizeConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return connectionString.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
}

/**
 * Resolves SSL configuration for PostgreSQL connection pool.
 * Security Invariant: Production connections must validate server certificates by default.
 * Silently setting rejectUnauthorized: false is strictly prohibited.
 */
export function getPoolSslConfig(
  connectionString: string
): boolean | { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (process.env.DB_SSL === 'false' || connectionString.includes('sslmode=disable')) {
    return false;
  }
  // Localhost / 127.0.0.1 default to non-SSL unless DB_SSL=true is explicitly forced
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    if (process.env.DB_SSL !== 'true') {
      return false;
    }
  }

  // Security Hardening: Validate server certificates by default (rejectUnauthorized: true)
  // Can only be relaxed if explicitly overridden via DB_SSL_REJECT_UNAUTHORIZED='false'
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  const ca = process.env.DB_SSL_CA;

  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

function extractAdvisoryArg(sql: string, funcName: string): string | null {
  const lower = sql.toLowerCase();
  const target = funcName.toLowerCase() + '(';
  const idx = lower.indexOf(target);
  if (idx === -1) return null;
  const start = idx + target.length;
  let depth = 1;
  let end = start;
  while (end < sql.length && depth > 0) {
    if (sql[end] === '(') depth++;
    else if (sql[end] === ')') depth--;
    end++;
  }
  if (depth === 0) {
    return sql.slice(start, end - 1).trim();
  }
  return null;
}

// ============================================================================
// Production PostgreSQL Connection Pool Client (Backed by pg.Pool)
// ============================================================================

export class PostgresDatabaseClient implements IDatabaseClient {
  private pool: Pool | null = null;
  private isClosing = false;
  private readonly connectionString: string;
  private readonly poolConfig?: PoolConfig;

  constructor(connectionString: string, config?: PoolConfig, poolInstance?: Pool) {
    this.connectionString = connectionString;
    this.poolConfig = config;
    if (poolInstance) {
      this.pool = poolInstance;
    }
  }

  getPool(): Pool {
    if (this.pool) return this.pool;
    if (this.isClosing) {
      throw new Error('[DATABASE_CLIENT_ERROR] Database connection pool is closing or closed.');
    }

    const ssl = this.poolConfig?.ssl !== undefined
      ? this.poolConfig.ssl
      : getPoolSslConfig(this.connectionString);

    const config: PoolConfig = {
      connectionString: this.connectionString,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
      ssl,
      ...this.poolConfig,
    };

    this.pool = new Pool(config);

    this.pool.on('error', (err) => {
      logger.error('[DATABASE_POOL_ERROR] Unexpected idle PostgreSQL client error', err);
    });

    if (typeof ssl === 'object' && ssl !== null && ssl.rejectUnauthorized === false) {
      logger.warn(
        '[SECURITY_WARNING] PostgreSQL connection pool configured with rejectUnauthorized: false. Server TLS certificates are NOT being validated. This configuration must not be used in production.'
      );
    }

    logger.info(
      `PostgreSQL connection pool initialized [target: ${sanitizeConnectionString(this.connectionString)}] [max: ${config.max}]`
    );
    return this.pool;
  }

  async isReady(): Promise<boolean> {
    if (this.isClosing) return false;
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT 1 as alive;');
      return (res.rowCount ?? res.rows.length) > 0;
    } catch (err: any) {
      logger.warn('[DATABASE_READINESS_CHECK_FAILED] PostgreSQL readiness check failed', {
        target: sanitizeConnectionString(this.connectionString),
        error: err?.message,
      });
      return false;
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const pool = this.getPool();
    const res = await pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(sql);
  }

  async transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();
    let inTransaction = false;
    let connectionErrored = false;

    client.on('error', (err) => {
      connectionErrored = true;
      logger.error('[TRANSACTION_CLIENT_ERROR] Active transaction client error', err);
    });

    try {
      await client.query('BEGIN;');
      inTransaction = true;

      const txClient: IDatabaseClient = {
        query: async <R = any>(sql: string, params?: any[]): Promise<QueryResult<R>> => {
          const res = await client.query(sql, params);
          return {
            rows: res.rows as R[],
            rowCount: res.rowCount ?? res.rows.length,
          };
        },
        exec: async (sql: string): Promise<void> => {
          await client.query(sql);
        },
        transaction: async <R>(_nested: (c: IDatabaseClient) => Promise<R>): Promise<R> => {
          throw new Error('[DATABASE_CLIENT_ERROR] Nested transactions via transaction() not supported.');
        },
        isReady: async (): Promise<boolean> => !connectionErrored,
        acquireSessionClient: async (): Promise<ISessionClient> => {
          throw new Error('[DATABASE_CLIENT_ERROR] Cannot acquire session client inside an active transaction.');
        },
      };

      const result = await callback(txClient);
      await client.query('COMMIT;');
      inTransaction = false;
      return result;
    } catch (err) {
      if (inTransaction && !connectionErrored) {
        try {
          await client.query('ROLLBACK;');
        } catch (rollbackErr) {
          connectionErrored = true;
          logger.error('[TRANSACTION_ROLLBACK_FAILED] Error executing ROLLBACK', rollbackErr);
        }
      }
      throw err;
    } finally {
      client.release(connectionErrored);
    }
  }

  async acquireSessionClient(): Promise<ISessionClient> {
    const pool = this.getPool();
    const client = await pool.connect();
    let released = false;
    let connectionErrored = false;

    client.on('error', (err) => {
      connectionErrored = true;
      logger.error('[SESSION_CLIENT_ERROR] Dedicated session client error', err);
    });

    return {
      query: async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }
        const res = await client.query(sql, params);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? res.rows.length,
        };
      },
      exec: async (sql: string): Promise<void> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }
        await client.query(sql);
      },
      transaction: async <T>(callback: (c: IDatabaseClient) => Promise<T>): Promise<T> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }
        await client.query('BEGIN;');
        try {
          const sessionTxClient: IDatabaseClient = {
            query: async <R = any>(qSql: string, qParams?: any[]): Promise<QueryResult<R>> => {
              if (released) {
                throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
              }
              const res = await client.query(qSql, qParams);
              return {
                rows: res.rows as R[],
                rowCount: res.rowCount ?? res.rows.length,
              };
            },
            exec: async (qSql: string): Promise<void> => {
              if (released) {
                throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
              }
              await client.query(qSql);
            },
            transaction: async <R>(_nested: (inner: IDatabaseClient) => Promise<R>): Promise<R> => {
              throw new Error('[DATABASE_CLIENT_ERROR] Nested transactions via transaction() not supported.');
            },
            isReady: async (): Promise<boolean> => !released && !connectionErrored,
            acquireSessionClient: async (): Promise<ISessionClient> => {
              throw new Error('[DATABASE_CLIENT_ERROR] Cannot acquire nested session from an active transaction.');
            },
          };
          const res = await callback(sessionTxClient);
          await client.query('COMMIT;');
          return res;
        } catch (err) {
          if (!connectionErrored) {
            try {
              await client.query('ROLLBACK;');
            } catch (rbErr) {
              connectionErrored = true;
              logger.error('[SESSION_TRANSACTION_ROLLBACK_FAILED] Error executing ROLLBACK', rbErr);
            }
          }
          throw err;
        }
      },
      isReady: async (): Promise<boolean> => {
        if (released || connectionErrored) return false;
        try {
          const res = await client.query('SELECT 1 as alive;');
          return (res.rowCount ?? res.rows.length) > 0;
        } catch {
          return false;
        }
      },
      acquireSessionClient: async (): Promise<ISessionClient> => {
        throw new Error('[DATABASE_CLIENT_ERROR] Cannot acquire nested session from an already checked-out session client.');
      },
      release: async (): Promise<void> => {
        if (released) return;
        try {
          // DEFENSE IN DEPTH: unlock any lingering session advisory locks on this connection
          // Guarantees no advisory locks poison idle connections in the pool
          if (!connectionErrored) {
            await client.query('SELECT pg_advisory_unlock_all();');
          }
        } catch (unlockAllErr: any) {
          connectionErrored = true;
          logger.warn('[SESSION_UNLOCK_ALL_WARNING] Failed to execute pg_advisory_unlock_all on release', {
            error: unlockAllErr?.message || String(unlockAllErr),
          });
        } finally {
          released = true;
          client.release(connectionErrored);
        }
      },
      isReleased: (): boolean => released,
    };
  }

  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('PostgreSQL connection pool cleanly drained and closed.');
    }
  }
}

// ============================================================================
// Development / Testing In-Process Database Client (PGlite WASM)
// ============================================================================

export class PGliteDatabaseClient implements IDatabaseClient {
  private pglite: PGlite | null = null;
  private isInitialized = false;
  // Session lock registry: maps lockKey -> sessionId to model multi-session mutual exclusion in PGlite
  private sessionLocks = new Map<string, string>();

  async init(): Promise<void> {
    if (this.isInitialized && this.pglite) return;

    // Fail-closed guard: prohibit ephemeral in-memory PGlite from silently running in production or staging
    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (
      (env === 'production' || env === 'staging' || process.env.VERCEL === '1') &&
      !process.env.ALLOW_IN_MEMORY_PGLITE_IN_PROD
    ) {
      throw new Error(
        '[CRITICAL_SECURITY_DEFECT] Production environment detected. Ephemeral in-memory PGlite database cannot be used for production persistence. A persistent PostgreSQL connection (DATABASE_URL) is required.'
      );
    }

    this.pglite = new PGlite({
      extensions: { btree_gist, pgcrypto, citext, uuid_ossp }
    });

    const projectRoot = process.cwd();
    const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');
    
    // Apply all migrations in lexical order
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await this.pglite.exec(sql);
    }

    // Apply seed if exists
    const seedPath = path.join(projectRoot, 'supabase', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      await this.pglite.exec(seedSql);
    }

    this.isInitialized = true;
    logger.info('PGlite in-process PostgreSQL database initialized successfully with migrations and seed data.');
  }

  async isReady(): Promise<boolean> {
    try {
      if (!this.pglite) await this.init();
      const res = await this.pglite!.query('SELECT 1 as alive;');
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    if (!this.pglite) await this.init();
    const result = await this.pglite!.query<T>(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rows.length
    };
  }

  async exec(sql: string): Promise<void> {
    if (!this.pglite) await this.init();
    await this.pglite!.exec(sql);
  }

  async transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    if (!this.pglite) await this.init();
    await this.pglite!.exec('BEGIN;');
    try {
      const result = await callback(this);
      await this.pglite!.exec('COMMIT;');
      return result;
    } catch (err) {
      await this.pglite!.exec('ROLLBACK;');
      throw err;
    }
  }

  async acquireSessionClient(): Promise<ISessionClient> {
    if (!this.pglite) await this.init();
    const sessionId = crypto.randomUUID();
    let released = false;

    return {
      query: async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }

        // Intercept pg_try_advisory_lock to enforce session mutual exclusion in single-engine PGlite
        const tryLockArg = extractAdvisoryArg(sql, 'pg_try_advisory_lock');
        if (tryLockArg) {
          const evalRes = await this.pglite!.query<any>(`SELECT (${tryLockArg})::text AS key;`);
          const lockKey = String(evalRes.rows[0]?.key);

          const existingHolder = this.sessionLocks.get(lockKey);
          if (existingHolder && existingHolder !== sessionId) {
            // Another distinct session actively holds this advisory lock!
            return {
              rows: [{ acquired: false }] as T[],
              rowCount: 1
            };
          }

          const res = await this.pglite!.query<T>(sql, params);
          this.sessionLocks.set(lockKey, sessionId);
          return {
            rows: res.rows,
            rowCount: res.rows.length
          };
        }

        // Intercept pg_advisory_unlock to release session tracking
        const unlockArg = extractAdvisoryArg(sql, 'pg_advisory_unlock');
        if (unlockArg) {
          const evalRes = await this.pglite!.query<any>(`SELECT (${unlockArg})::text AS key;`);
          const lockKey = String(evalRes.rows[0]?.key);

          this.sessionLocks.delete(lockKey);
          const res = await this.pglite!.query<T>(sql, params);
          return {
            rows: res.rows,
            rowCount: res.rows.length
          };
        }

        return this.query<T>(sql, params);
      },
      exec: async (sql: string): Promise<void> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }
        return this.exec(sql);
      },
      transaction: async <T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> => {
        if (released) {
          throw new Error('[DATABASE_CLIENT_ERROR] Connection has already been released back to pool.');
        }
        return this.transaction<T>(callback);
      },
      isReady: async (): Promise<boolean> => {
        return !released && this.isReady();
      },
      acquireSessionClient: async (): Promise<ISessionClient> => {
        throw new Error('[DATABASE_CLIENT_ERROR] Cannot acquire nested session from an already checked-out session client.');
      },
      release: async (): Promise<void> => {
        // Automatically release any locks held by this session on pool return (prevents pool poisoning)
        for (const [key, holderId] of this.sessionLocks.entries()) {
          if (holderId === sessionId) {
            this.sessionLocks.delete(key);
            try {
              await this.pglite!.query(`SELECT pg_advisory_unlock(${key});`);
            } catch {
              // Ignore unlock error on connection reset
            }
          }
        }
        released = true;
      },
      isReleased: (): boolean => released
    };
  }

  async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
      this.isInitialized = false;
    }
  }
}

// ============================================================================
// Fail-Closed Client: Used when Production/Staging Persistence is Unconfigured
// ============================================================================

export class ProductionUnconfiguredClient implements IDatabaseClient {
  async isReady(): Promise<boolean> {
    return false;
  }
  async query<T = any>(_sql: string, _params?: any[]): Promise<QueryResult<T>> {
    throw new Error(
      '[CRITICAL_CONFIG_ERROR] Production persistence not configured: DATABASE_URL is missing. In-memory PGlite is disabled in production to prevent data loss.'
    );
  }
  async exec(_sql: string): Promise<void> {
    throw new Error(
      '[CRITICAL_CONFIG_ERROR] Production persistence not configured: DATABASE_URL is missing. In-memory PGlite is disabled in production to prevent data loss.'
    );
  }
  async transaction<T>(_callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    throw new Error(
      '[CRITICAL_CONFIG_ERROR] Production persistence not configured: DATABASE_URL is missing. In-memory PGlite is disabled in production to prevent data loss.'
    );
  }
  async acquireSessionClient(): Promise<ISessionClient> {
    throw new Error(
      '[CRITICAL_CONFIG_ERROR] Production persistence not configured: DATABASE_URL is missing. In-memory PGlite is disabled in production to prevent data loss.'
    );
  }
  async close(): Promise<void> {
    // No-op
  }
}

// ============================================================================
// Database Client Factory & Singleton
// ============================================================================

export interface DatabaseClientFactoryOptions {
  databaseUrl?: string;
  nodeEnv?: string;
  vercel?: string;
  forcePostgres?: boolean;
  allowInMemoryInProd?: boolean;
  poolConfig?: PoolConfig;
}

export function createDatabaseClient(options?: DatabaseClientFactoryOptions): IDatabaseClient {
  const nodeEnv = (options?.nodeEnv ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  const vercel = options?.vercel ?? process.env.VERCEL;
  const isStagingOrProd = nodeEnv === 'production' || nodeEnv === 'staging' || vercel === '1';
  const forcePostgres = options?.forcePostgres ?? process.env.FORCE_POSTGRES === 'true';
  const allowInMemory = options?.allowInMemoryInProd ?? process.env.ALLOW_IN_MEMORY_PGLITE_IN_PROD === 'true';
  const dbUrl = (options?.databaseUrl ?? process.env.DATABASE_URL)?.trim();

  // Explicit PostgreSQL selection
  if (forcePostgres || (isStagingOrProd && dbUrl)) {
    if (!dbUrl) {
      throw new Error(
        `[CRITICAL_CONFIG_ERROR] Persistent PostgreSQL connection requested but DATABASE_URL is missing or empty.`
      );
    }
    return new PostgresDatabaseClient(dbUrl, options?.poolConfig);
  }

  // Staging or production without DATABASE_URL: fail closed
  if (isStagingOrProd) {
    if (allowInMemory) {
      logger.warn(
        `[WARNING_SECURITY_OVERRIDE] In-memory PGlite enabled in ${nodeEnv} due to explicit ALLOW_IN_MEMORY_PGLITE_IN_PROD override.`
      );
      return new PGliteDatabaseClient();
    }
    return new ProductionUnconfiguredClient();
  }

  // Development / test: if explicit DATABASE_URL and USE_POSTGRES=true
  if (dbUrl && process.env.USE_POSTGRES === 'true') {
    return new PostgresDatabaseClient(dbUrl, options?.poolConfig);
  }

  // Default development / test engine: PGlite in-memory database
  return new PGliteDatabaseClient();
}

// Singleton database instance
export const db: IDatabaseClient = createDatabaseClient();
