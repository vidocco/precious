import type { Auth } from './auth/auth.ts';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';

/** Everything route plugins need, created once at startup. */
export interface AppContext {
  config: Config;
  database: Database;
  auth: Auth;
}
