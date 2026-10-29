import http from 'http';
import fs from 'fs';
import path from 'path';
import net from 'net';

/**
 * Finds a free, available TCP port.
 */
export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to obtain server address')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * MIME types for static asset delivery.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface WorktreeServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Launches an isolated, zero-dependency static HTTP server for the built worktree dist folder.
 * Uses SPA fallback to index.html for client-side React routes.
 */
export async function serveWorktreeDist(worktreePath: string): Promise<WorktreeServerHandle> {
  const distDir = path.join(worktreePath, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`Worktree dist directory does not exist at ${distDir}. Did "npm run build" succeed?`);
  }

  const port = await getAvailablePort();
  const indexHtmlPath = path.join(distDir, 'index.html');

  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      let reqPath = decodeURIComponent(parsedUrl.pathname);

      if (reqPath.endsWith('/')) {
        reqPath += 'index.html';
      }

      let filePath = path.join(distDir, reqPath);

      // Security check: ensure path stays within distDir
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // SPA Fallback
        filePath = indexHtmlPath;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    } catch (err: any) {
      res.writeHead(500);
      res.end(`Internal Server Error: ${err?.message || String(err)}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve();
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
