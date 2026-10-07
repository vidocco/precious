import type { RunStage } from '@precious/shared';

/** A failure in one stage of running an endpoint, with a message meant for people. */
export class StageError extends Error {
  constructor(
    readonly stage: RunStage,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}
