import { describe, expect, it, vi } from 'vitest';
import {
  createInlineDispatcher,
  type BackgroundScheduler,
} from '../../src/modules/casemgmt/investigationDispatcher.js';

describe('createInlineDispatcher', () => {
  it('dispatch_withCustomScheduler_handsTheRunToTheScheduler', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduled: Array<() => Promise<void>> = [];
    const schedule: BackgroundScheduler = (task) => scheduled.push(task);
    const dispatcher = createInlineDispatcher(run, schedule);

    await dispatcher.dispatch({ caseId: 42, reason: 'CASE_CREATED' }, 'run-1');

    expect(run).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(run).toHaveBeenCalledWith(42, 'run-1');
  });

  it('dispatch_withDefaultScheduler_runsAfterTheCurrentTick', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createInlineDispatcher(run);

    await dispatcher.dispatch({ caseId: 7, reason: 'RERUN' }, 'run-2');
    expect(run).not.toHaveBeenCalled();

    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledWith(7, 'run-2');
  });
});
