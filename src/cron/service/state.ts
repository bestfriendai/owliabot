import type { CronDeps, CronStore } from "../types.js";

export interface CronServiceState {
  deps: Required<CronDeps> & { nowMs: () => number };
  store: CronStore | null;
  timer: NodeJS.Timeout | null;
  running: boolean;
  op: Promise<void>;
  warnedDisabled: boolean;
}

export function createCronServiceState(deps: CronDeps): CronServiceState {
  return {
    deps: { ...deps, nowMs: deps.nowMs ?? (() => Date.now()) } as any,
    store: null,
    timer: null,
    running: false,
    op: Promise.resolve(),
    warnedDisabled: false,
  };
}
