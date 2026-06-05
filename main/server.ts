import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { registerRoutes } from './routes';
import { getDbHealth } from './db';
import { setupKdsWebSocket } from './services/kds';

let server: http.Server | null = null;
let app: Express;
let wss: WebSocketServer;

const PORT = parseInt(process.env.PORT || '3001', 10);

export function isServerRunning(): boolean {
  return server !== null;
}

/**
 * Locate the Next.js static export directory.
 *
 * Dev build  → <repo-root>/frontend/out
 * Packaged   → <resourcesPath>/frontend-out   (see electron-builder extraResources)
 */
function getFrontendDir(): string | null {
  const candidates = [
    // Development / unpackaged: relative to dist/
    path.join(__dirname, '../frontend/out'),
    // Packaged: electron-builder copies it to resources/frontend-out
    path.join(process.resourcesPath || '', 'frontend-out'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    app = express();

    app.use(cors());
    app.use(express.json());

    // ── API health check ───────────────────────────────────────────────
    app.get('/api/health', (_req: Request, res: Response) => {
      const db = getDbHealth();
      res.status(db.ok ? 200 : 503).json({
        status: db.ok ? 'ok' : 'error',
        db: db.ok ? 'ok' : db.error,
        service: 'Flo Local API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    });

    // ── All API routes ─────────────────────────────────────────────────
    registerRoutes(app);

    // ── Serve Next.js static export ────────────────────────────────────
    // Must come AFTER API routes so /api/* is not caught by the SPA fallback.
    const frontendDir = getFrontendDir();
    if (frontendDir) {
      console.log(`[Server] Serving frontend from: ${frontendDir}`);
      app.use(express.static(frontendDir));

      // SPA fallback: any unknown path returns index.html so Next.js
      // client-side routing works. Exclude /api (API routes) and /kds.
      app.get(/^(?!\/api|\/kds).*$/, (_req: Request, res: Response) => {
        res.sendFile(path.join(frontendDir, 'index.html'));
      });
    } else {
      console.warn('[Server] Frontend build not found. Run `npm run build:frontend` first.');
      app.get('/', (_req: Request, res: Response) => {
        res.send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h2>Flo – Frontend not built</h2>
            <p>Run <code>npm run build:frontend</code> then restart the app.</p>
          </body></html>
        `);
      });
    }

    // ── Global error handler ───────────────────────────────────────────
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[Server] Error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    });

    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] HTTP server running on http://localhost:${PORT}`);

      if (server) {
        wss = new WebSocketServer({ server, path: '/kds' });
        setupKdsWebSocket(wss);
        console.log(`[Server] KDS WebSocket running on ws://localhost:${PORT}/kds`);
      }

      resolve();
    });

    server?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Server] Port ${PORT} in use, trying ${PORT + 1}`);
        server?.listen(PORT + 1, '0.0.0.0');
      } else {
        reject(err);
      }
    });
  });
}

export function stopServer(): void {
  if (wss) wss.close();
  if (server) server.close();
  console.log('[Server] HTTP server stopped');
}

/** Returns the first non-loopback IPv4 address on the machine. */
export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}
