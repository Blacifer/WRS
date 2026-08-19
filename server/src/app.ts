/**
 * Express Application Setup
 * Indian Railways WRS Raipur
 */

import { express, cors, ExpressApp } from './framework/index.ts';
import type { Request, Response, NextFunction } from './framework/index.ts';
import { apiRouter } from './routes/index.ts';
import { requestLogger } from './middleware/requestLogger.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { getDatabase } from './db/connection.ts';
import { runMigrations } from './db/migrations.ts';
import { seedUsers } from './db/seed.ts';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../../client/dist');

export function createApp(dbPath?: string): ExpressApp {
  const app = express();

  // Initialize DB schema & seed
  const db = getDatabase(dbPath);
  runMigrations(db);
  seedUsers(db);

  // Core Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger);

  // Mount API Routes
  app.use('/api', apiRouter);

  // Static assets serving if client/dist exists
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));

    // SPA fallback for GET requests that are not /api
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path && req.path.startsWith('/api')) {
        return next();
      }
      const indexPath = path.join(clientDistPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
      next();
    });
  }

  // Root health ping (if no client dist index.html was served)
  app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
      name: 'Indian Railways WRS Raipur Spring Classification System API',
      status: 'online',
      version: '1.0.0',
      rdso: 'RDSO Technical Pamphlet G-95 Revision-II'
    });
  });

  // 404 Catch-All
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
  });

  // Centralized Global Error Handler
  app.use(errorHandler);

  return app;
}

