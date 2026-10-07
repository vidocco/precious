import type { Auth } from './auth/auth.ts';
import type { Config } from './config.ts';
import type { ConnectorRuntime } from './connectors/runner.ts';
import type { Database } from './db/client.ts';
import type { Scheduler } from './services/computed.ts';

/** Everything route plugins need, created once at startup. */
export interface AppContext {
  config: Config;
  database: Database;
  auth: Auth;
  connectors: ConnectorRuntime;
  /** Looks up scheduled values; poke it when something is due now. */
  scheduler: Scheduler;
}
