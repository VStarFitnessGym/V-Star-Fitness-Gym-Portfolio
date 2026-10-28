// ============================================================================
// Real PostgreSQL Integration Verification Script
// Master Prompt 13: Integration Test Safety Guard & Local PostgreSQL Setup
//
// Security & Environmental Isolation Invariants:
// 1. Requires TEST_POSTGRES_URL exclusively (Never falls back to DATABASE_URL)
// 2. Refuses to run if TEST_POSTGRES_URL is missing
// 3. Validates database name before connecting: requires explicit disposable test DB ('fitfusion_test')
// 4. Rejects unsafe names: 'postgres', 'production', 'prod', 'main', 'master', 'live'
// 5. Diagnostics print ONLY hostname and database name (Never passwords, secrets, or full URL)
// 6. Uses temporary test objects (TEMPORARY TABLE) and cleans them up explicitly
// 7. Exits safely with BLOCKED status and instructions if isolation cannot be established
// ============================================================================

import {
  PostgresDatabaseClient,
  createDatabaseClient,
  ProductionUnconfiguredClient,
} from '../../server/db/database';

export interface ValidatedTestDatabase {
  hostname: string;
  port: string;
  databaseName: string;
  connectionString: string;
}

/**
 * Validates that TEST_POSTGRES_URL points to a strictly isolated, disposable test database.
 * Never falls back to DATABASE_URL or production variables.
 */
export function validateTestDatabaseUrl(rawUrl: string | undefined): ValidatedTestDatabase {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      '[SAFETY_GUARD_BLOCKED] TEST_POSTGRES_URL is missing.\n' +
      'Live PostgreSQL integration tests require TEST_POSTGRES_URL to be set explicitly.\n' +
      'Automatic fallback to DATABASE_URL or production credentials is strictly prohibited to prevent data corruption.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err: any) {
    throw new Error(`[SAFETY_GUARD_BLOCKED] Malformed TEST_POSTGRES_URL format: ${err.message}`);
  }

  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (protocol !== 'postgres' && protocol !== 'postgresql') {
    throw new Error(
      `[SAFETY_GUARD_BLOCKED] Invalid protocol '${parsed.protocol}'. Expected 'postgresql:' or 'postgres:'.`
    );
  }

  // Extract database name (path without leading slash)
  const dbName = parsed.pathname.replace(/^\//, '').trim().toLowerCase();

  if (!dbName) {
    throw new Error(
      '[SAFETY_GUARD_BLOCKED] TEST_POSTGRES_URL does not specify a target database name in the connection path.'
    );
  }

  // Reject administrative and production database names
  const prohibitedNames = new Set([
    'postgres',
    'production',
    'prod',
    'main',
    'master',
    'live',
    'defaultdb',
  ]);

  if (prohibitedNames.has(dbName)) {
    throw new Error(
      `[SAFETY_GUARD_BLOCKED] Target database name '${dbName}' is unsafe for automated testing.\n` +
      `Connecting to default administrative or production database names ('postgres', 'production', 'prod') is strictly rejected.\n` +
      `A dedicated disposable test database (e.g. 'fitfusion_test') is required.`
    );
  }

  // Enforce test database naming convention: must contain 'test'
  if (!dbName.includes('test')) {
    throw new Error(
      `[SAFETY_GUARD_BLOCKED] Target database name '${dbName}' does not conform to test database naming safety rules.\n` +
      `The database name must contain 'test' (e.g. 'fitfusion_test') to guarantee environmental isolation.`
    );
  }

  // If application DATABASE_URL is configured, verify that TEST_POSTGRES_URL does not point to the exact same database
  if (process.env.DATABASE_URL) {
    try {
      const prodUrl = new URL(process.env.DATABASE_URL.trim());
      const prodDbName = prodUrl.pathname.replace(/^\//, '').trim().toLowerCase();
      if (
        parsed.hostname.toLowerCase() === prodUrl.hostname.toLowerCase() &&
        (parsed.port || '5432') === (prodUrl.port || '5432') &&
        dbName === prodDbName
      ) {
        throw new Error(
          '[SAFETY_GUARD_BLOCKED] Collision detected: TEST_POSTGRES_URL matches application DATABASE_URL.\n' +
          'Refusing to run integration tests against the configured application database.'
        );
      }
    } catch (e: any) {
      if (e.message.includes('[SAFETY_GUARD_BLOCKED]')) {
        throw e;
      }
    }
  }

  return {
    hostname: parsed.hostname,
    port: parsed.port || '5432',
    databaseName: dbName,
    connectionString: rawUrl.trim(),
  };
}

interface TestStepResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestStepResult[] = [];

function assertStep(condition: boolean, name: string, details = '') {
  if (condition) {
    results.push({ name, passed: true, details });
    console.log(`  [PASS] ${name}`);
  } else {
    results.push({ name, passed: false, details });
    console.error(`  [FAIL] ${name}: ${details}`);
    throw new Error(`Step failed: ${name} - ${details}`);
  }
}

async function runRealPostgresIntegration() {
  console.log('================================================================');
  console.log('MASTER PROMPT 13: REAL POSTGRESQL INTEGRATION SAFETY GUARD');
  console.log('Target: Live PostgreSQL Engine (Isolated Test Database)');
  console.log('================================================================\n');

  // Task 2 Invariant: Exclusively read TEST_POSTGRES_URL (Never DATABASE_URL)
  const rawTestUrl = process.env.TEST_POSTGRES_URL;

  let validatedTarget: ValidatedTestDatabase;
  try {
    validatedTarget = validateTestDatabaseUrl(rawTestUrl);
  } catch (guardErr: any) {
    console.log('--- Isolation & Safety Guard Check ---');
    console.log(`  ${guardErr.message}\n`);
    console.log('================================================================');
    console.log('REAL POSTGRESQL INTEGRATION STATUS: BLOCKED');
    console.log('Reason: Test database isolation could not be established.');
    console.log('Setup Instructions:');
    console.log('  1. Start an isolated disposable PostgreSQL test instance:');
    console.log('     docker run -d --name fitfusion-test-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fitfusion_test postgres:16-alpine');
    console.log('  2. Set TEST_POSTGRES_URL in PowerShell (Must target a *_test database):');
    console.log('     $env:TEST_POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/fitfusion_test?sslmode=disable"');
    console.log('  3. Re-run:');
    console.log('     npm run test:postgres:real');
    console.log('================================================================\n');
    process.exit(2);
  }

  // Print ONLY hostname, port, and database name — NEVER credentials or connection string
  console.log('--- Target Diagnostics (Credentials Strictly Redacted) ---');
  console.log(`  Target Host:     ${validatedTarget.hostname}`);
  console.log(`  Target Port:     ${validatedTarget.port}`);
  console.log(`  Target Database: ${validatedTarget.databaseName} (Verified isolated test database)`);

  // Step 1: Fail-Closed Production Configuration Guard
  console.log('\n--- Step 1: Fail-Closed Production Configuration Guard ---');
  const unconfigured = createDatabaseClient({
    nodeEnv: 'production',
    databaseUrl: '',
  });
  assertStep(
    unconfigured instanceof ProductionUnconfiguredClient,
    'Step 1A: Production without DATABASE_URL instantiates ProductionUnconfiguredClient'
  );
  let failClosedThrew = false;
  try {
    await unconfigured.query('SELECT 1;');
  } catch (err: any) {
    failClosedThrew = true;
    assertStep(
      err.message.includes('[CRITICAL_CONFIG_ERROR]'),
      'Step 1B: Query on unconfigured production client throws [CRITICAL_CONFIG_ERROR]'
    );
  }
  assertStep(failClosedThrew, 'Step 1C: Unconfigured production client strictly blocked');

  // Step 2: Live Connection & Parameterized Queries
  console.log('\n--- Step 2: Live Connection & Parameterized Queries ---');
  const client = new PostgresDatabaseClient(validatedTarget.connectionString);

  const ready = await client.isReady();
  assertStep(ready === true, 'Step 2A: isReady() returns true for live PostgreSQL connection');

  const paramRes = await client.query<{ echoed: string; num: number }>(
    `SELECT $1::text AS echoed, ($2::int * 2) AS num;`,
    ['FitFusion_Live_Test', 21]
  );
  assertStep(paramRes.rows.length === 1, 'Step 2B: Query returns 1 row');
  assertStep(paramRes.rowCount === 1, 'Step 2C: rowCount matches 1');
  assertStep(paramRes.rows[0].echoed === 'FitFusion_Live_Test', 'Step 2D: Parameter $1 correctly passed and returned');
  assertStep(paramRes.rows[0].num === 42, 'Step 2E: Parameter $2 evaluated correctly (21 * 2 = 42)');

  // Step 3: Transaction Commit and Rollback using temporary table
  console.log('\n--- Step 3: Transaction Commit and Rollback ---');
  await client.exec(`
    CREATE TEMPORARY TABLE IF NOT EXISTS _integration_test_tx (
      id serial primary key,
      label text not null
    );
  `);

  // Transaction Commit Test
  await client.transaction(async (tx) => {
    await tx.query(`INSERT INTO _integration_test_tx (label) VALUES ($1);`, ['committed_record']);
  });

  const committedCheck = await client.query(`SELECT count(*)::int as cnt FROM _integration_test_tx WHERE label = $1;`, [
    'committed_record',
  ]);
  assertStep(committedCheck.rows[0].cnt === 1, 'Step 3A: Transaction successfully committed changes to database');

  // Transaction Rollback Test
  let rollbackThrew = false;
  try {
    await client.transaction(async (tx) => {
      await tx.query(`INSERT INTO _integration_test_tx (label) VALUES ($1);`, ['aborted_record']);
      throw new Error('INTENTIONAL_TX_FAILURE');
    });
  } catch (err: any) {
    rollbackThrew = true;
    assertStep(err.message === 'INTENTIONAL_TX_FAILURE', 'Step 3B: Intentional transaction failure intercepted');
  }
  assertStep(rollbackThrew, 'Step 3C: Transaction block threw exception on failure');

  const abortedCheck = await client.query(`SELECT count(*)::int as cnt FROM _integration_test_tx WHERE label = $1;`, [
    'aborted_record',
  ]);
  assertStep(abortedCheck.rows[0].cnt === 0, 'Step 3D: Transaction rollback discarded all changes on error');

  // Clean up temporary test table
  await client.exec(`DROP TABLE IF EXISTS _integration_test_tx;`);

  // Step 4: Connection Release After Exceptions
  console.log('\n--- Step 4: Connection Release After Exceptions ---');
  let queryErrorThrew = false;
  try {
    await client.query(`SELECT * FROM nonexistent_table_for_syntax_error_test;`);
  } catch {
    queryErrorThrew = true;
  }
  assertStep(queryErrorThrew, 'Step 4A: Query error was raised on invalid table');

  const recoveryQuery = await client.query(`SELECT 1 as alive;`);
  assertStep(recoveryQuery.rows[0].alive === 1, 'Step 4B: Pool remains healthy and functional after query exception');

  // Step 5: Multi-Connection Advisory Lock Mutual Exclusion
  console.log('\n--- Step 5: Multi-Connection Advisory Lock Mutual Exclusion ---');
  const lockKeyId = 987654321; // Dedicated test advisory key

  // Connection 1 checks out dedicated session
  const session1 = await client.acquireSessionClient();
  const lock1Res = await session1.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired;`,
    [lockKeyId]
  );
  assertStep(lock1Res.rows[0].acquired === true, 'Step 5A: Connection 1 successfully acquired session advisory lock');

  // Connection 2 checks out a separate dedicated session
  const session2 = await client.acquireSessionClient();
  const lock2Res = await session2.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired;`,
    [lockKeyId]
  );
  assertStep(
    lock2Res.rows[0].acquired === false,
    'Step 5B: Connection 2 was strictly blocked from acquiring lock actively held by Connection 1 (Mutual exclusion)'
  );

  // Connection 1 releases the lock explicitly
  const unlock1Res = await session1.query<{ unlocked: boolean }>(
    `SELECT pg_advisory_unlock($1) AS unlocked;`,
    [lockKeyId]
  );
  assertStep(unlock1Res.rows[0].unlocked === true, 'Step 5C: Connection 1 released session advisory lock');

  // Connection 2 can now acquire the lock immediately
  const lock2Reacquire = await session2.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired;`,
    [lockKeyId]
  );
  assertStep(
    lock2Reacquire.rows[0].acquired === true,
    'Step 5D: Connection 2 successfully acquired lock after Connection 1 released it'
  );

  // Connection 2 releases the lock via session release cleanup (defense-in-depth pg_advisory_unlock_all)
  await session2.release();
  assertStep(session2.isReleased() === true, 'Step 5E: Connection 2 session marked released');

  // Connection 1 verifies lock is now free again
  const lock1Reacquire = await session1.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired;`,
    [lockKeyId]
  );
  assertStep(
    lock1Reacquire.rows[0].acquired === true,
    'Step 5F: Connection 1 reacquired lock released via Connection 2 session.release() cleanup'
  );

  // Clean up lock on Connection 1
  await session1.query(`SELECT pg_advisory_unlock($1);`, [lockKeyId]);
  await session1.release();
  assertStep(session1.isReleased() === true, 'Step 5G: Connection 1 session marked released');

  // Step 6: Post-Release Protection
  console.log('\n--- Step 6: Post-Release Safety Guard ---');
  let postReleaseQueryThrew = false;
  try {
    await session1.query('SELECT 1;');
  } catch (err: any) {
    postReleaseQueryThrew = true;
    assertStep(
      err.message.includes('already been released'),
      'Step 6A: Calling query() on released session throws [DATABASE_CLIENT_ERROR]'
    );
  }
  assertStep(postReleaseQueryThrew, 'Step 6B: Post-release query strictly blocked');

  // Step 7: Clean Pool Shutdown
  console.log('\n--- Step 7: Clean Pool Shutdown ---');
  await client.close();
  let queryAfterCloseThrew = false;
  try {
    await client.query('SELECT 1;');
  } catch (err: any) {
    queryAfterCloseThrew = true;
    assertStep(
      err.message.includes('closing or closed'),
      'Step 7A: Calling query() after close() throws [DATABASE_CLIENT_ERROR]'
    );
  }
  assertStep(queryAfterCloseThrew, 'Step 7B: Operations on closed pool strictly prevented');

  console.log('\n================================================================');
  console.log(`REAL POSTGRESQL INTEGRATION: ALL ${results.length}/${results.length} CHECKS PASSED`);
  console.log('================================================================\n');
}

// Execute only when directly invoked from CLI
const isDirectEntry = Boolean(
  process.argv[1] && (
    process.argv[1].endsWith('test_real_postgres_integration.ts') ||
    process.argv[1].endsWith('test_real_postgres_integration.js')
  )
);

if (isDirectEntry) {
  runRealPostgresIntegration().catch((err) => {
    console.error('\nReal PostgreSQL integration test encountered failure:', err);
    process.exit(1);
  });
}
