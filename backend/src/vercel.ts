import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.js';
import { ErrorCode } from './common/errors.js';
import { logger } from './common/logger.js';
import { createContainer } from './container.js';
import { connectDb } from './infra/db.js';
import type { BackgroundScheduler } from './modules/casemgmt/investigationDispatcher.js';

/**
 * Vercel serverless entry (see backend/vercel.json). Unlike index.ts it never calls listen()
 * and never starts a BullMQ worker: a function instance can't host a long-lived consumer.
 * Agent runs go inline instead, kept alive past the 202 response by `waitUntil`.
 */
/** Same lookup `@vercel/functions` uses for waitUntil, without adding the dependency. */
const VERCEL_REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

interface VercelRequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

function vercelWaitUntil(): VercelRequestContext['waitUntil'] {
  const holder = (globalThis as Record<symbol, { get?: () => VercelRequestContext } | undefined>)[VERCEL_REQUEST_CONTEXT];
  return holder?.get?.().waitUntil;
}

const scheduleWithWaitUntil: BackgroundScheduler = (task) => {
  const waitUntil = vercelWaitUntil();
  if (!waitUntil) logger.warn({ event: 'WAIT_UNTIL_UNAVAILABLE' }, 'No Vercel request context; agent run may be cut short');
  const run = Promise.resolve()
    .then(task)
    .catch((err: unknown) => {
      logger.error({ event: 'AGENT_BACKGROUND_FAILED', err: (err as Error).message }, 'Background agent run failed');
    });
  waitUntil?.(run);
};

async function buildApp(): Promise<Express> {
  await connectDb();
  const container = createContainer({ dispatch: 'inline', schedule: scheduleWithWaitUntil });
  return createApp({ caseService: container.caseService });
}

let appPromise: Promise<Express> | undefined;

/** Reuses the app (and its Mongo pool) across warm invocations; retries on the next request if startup failed. */
function getApp(): Promise<Express> {
  appPromise ??= buildApp().catch((err: unknown) => {
    appPromise = undefined;
    throw err;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err) {
    logger.error({ event: 'STARTUP_FAILED', err: (err as Error).message }, 'Serverless startup failed');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong', traceId: null }));
  }
}
