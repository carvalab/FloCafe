/** Usage counts that leave no row: orders taken through the Server App and report downloads. */

import type { NextFunction, Request, Response } from 'express';

export type UsageCounter = 'server_app_orders' | 'exports';

const counters: Record<UsageCounter, number> = { server_app_orders: 0, exports: 0 };

export function bumpUsageCounter(name: UsageCounter): void {
  counters[name] += 1;
}

/**
 * The delta since the last read, then a reset.
 * shortcut: memory only, so a restart inside the 24h window loses the counts it held.
 */
export function readUsageCounters(): Record<UsageCounter, number> {
  const delta = { ...counters };
  counters.server_app_orders = 0;
  counters.exports = 0;
  return delta;
}

/**
 * A 2xx response that offers a file is an export: reports, menu CSV exports and templates, print
 * templates. A database backup download under `/api/db` is not one.
 */
export function exportCounterMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/db')) {
    next();
    return;
  }
  res.on('finish', () => {
    const disposition = res.getHeader('content-disposition');
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    if (typeof disposition === 'string' && disposition.toLowerCase().includes('attachment')) {
      bumpUsageCounter('exports');
    }
  });
  next();
}
