/**
 * Config type exports
 */

import type { Config } from "./schema.js";

export type { Config };

export interface ConfigLoader {
  load(path: string): Promise<Config>;
}
