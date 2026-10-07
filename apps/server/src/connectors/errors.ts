import type { RunStage } from '@precious/shared';

/** A failure in one stage of running an endpoint, with a message meant for people. */
export class StageError extends Error {
  readonly stage: RunStage;
  readonly path?: string;

  constructor(stage: RunStage, message: string, path?: string) {
    super(message);
    this.stage = stage;
    if (path !== undefined) this.path = path;
  }
}
