/**
 * Native Zero-Dependency Express-Compatible Server Framework
 * Indian Railways WRS Raipur
 *
 * Provides full Express-compatible API (Router, Middleware, Body Parsers, CORS,
 * Parameterized Routes, Route Guards, Error Handlers) with native Node.js HTTP.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export type NextFunction = (err?: any) => void;
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
export type ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => void | Promise<void>;
export type Handler = RequestHandler | ErrorRequestHandler;

export interface Request extends http.IncomingMessage {
  body?: any;
  query?: Record<string, string>;
  params?: Record<string, string>;
  path?: string;
  originalUrl?: string;
  user?: any;
}

export interface Response extends http.ServerResponse {
  status(code: number): this;
  json(data: any): void;
  send(data: any): void;
}

interface RouteLayer {
  method?: string; // 'GET', 'POST', etc. undefined for middleware
  path?: string;
  prefix?: string;
  regex?: RegExp;
  paramNames?: string[];
  handler: Handler;
  isSubRouter?: boolean;
  subRouter?: RouterInstance;
}

function pathToRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  if (path === '/' || path === '') {
    return { regex: /^\/?$/, paramNames };
  }

  const parts = path.split('/').filter(Boolean);
  const patternParts = parts.map((part, index) => {
    if (part.startsWith(':')) {
      const name = part.slice(1);
      paramNames.push(name);
      if (index < parts.length - 1) {
        return '(.+?)';
      }
      return '(.+)';
    }
    return part.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  });

  const regex = new RegExp(`^/${patternParts.join('/')}/?$`);
  return { regex, paramNames };
}

export class RouterInstance {
  public layers: RouteLayer[] = [];

  public use(pathOrHandler: string | Handler | RouterInstance, ...handlers: (Handler | RouterInstance)[]): this {
    if (typeof pathOrHandler === 'string') {
      const prefix = pathOrHandler === '/' ? '' : pathOrHandler;
      for (const h of handlers) {
        if (h instanceof RouterInstance) {
          this.layers.push({
            prefix,
            isSubRouter: true,
            subRouter: h,
            handler: (req, res, next) => next()
          });
        } else {
          this.layers.push({
            prefix,
            handler: h as Handler
          });
        }
      }
    } else if (pathOrHandler instanceof RouterInstance) {
      this.layers.push({
        prefix: '',
        isSubRouter: true,
        subRouter: pathOrHandler,
        handler: (req, res, next) => next()
      });
    } else {
      this.layers.push({
        prefix: '',
        handler: pathOrHandler as Handler
      });
      for (const h of handlers) {
        if (h instanceof RouterInstance) {
          this.layers.push({
            prefix: '',
            isSubRouter: true,
            subRouter: h,
            handler: (req, res, next) => next()
          });
        } else {
          this.layers.push({
            prefix: '',
            handler: h as Handler
          });
        }
      }
    }
    return this;
  }

  public get(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('GET', path, handlers);
  }

  public post(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('POST', path, handlers);
  }

  public put(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('PUT', path, handlers);
  }

  public patch(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('PATCH', path, handlers);
  }

  public delete(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('DELETE', path, handlers);
  }

  public options(path: string, ...handlers: RequestHandler[]): this {
    return this.addRoute('OPTIONS', path, handlers);
  }

  private addRoute(method: string, path: string, handlers: RequestHandler[]): this {
    const { regex, paramNames } = pathToRegex(path);
    for (const h of handlers) {
      this.layers.push({
        method: method.toUpperCase(),
        path,
        regex,
        paramNames,
        handler: h
      });
    }
    return this;
  }

  public async handle(
    req: Request,
    res: Response,
    currentPath: string,
    done: (err?: any) => void
  ): Promise<void> {
    let index = 0;

    const next = async (err?: any): Promise<void> => {
      if (res.writableEnded) return;

      if (index >= this.layers.length) {
        return done(err);
      }

      const layer = this.layers[index++];

      // Error handler execution
      if (err) {
        if (layer.handler.length === 4) {
          try {
            await (layer.handler as ErrorRequestHandler)(err, req, res, next);
          } catch (e) {
            next(e);
          }
        } else {
          next(err);
        }
        return;
      }

      // Normal middleware or route execution
      if (layer.handler.length === 4) {
        // Skip error handlers during normal execution
        return next();
      }

      if (layer.isSubRouter && layer.subRouter) {
        const prefix = layer.prefix || '';
        if (prefix === '' || currentPath.startsWith(prefix)) {
          const subPath = prefix === '' ? currentPath : currentPath.slice(prefix.length) || '/';
          return layer.subRouter.handle(req, res, subPath, next);
        }
        return next();
      }

      if (layer.method) {
        // Method match
        if (layer.method !== req.method && layer.method !== 'ALL') {
          return next();
        }

        // Path match
        if (layer.regex && layer.paramNames) {
          const match = currentPath.match(layer.regex);
          if (!match) {
            return next();
          }

          // Extract route params
          const params: Record<string, string> = {};
          layer.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1]);
          });
          req.params = { ...(req.params || {}), ...params };

          try {
            await (layer.handler as RequestHandler)(req, res, next);
          } catch (e) {
            next(e);
          }
          return;
        }
      } else {
        // Plain middleware
        const prefix = layer.prefix || '';
        if (prefix === '' || currentPath.startsWith(prefix)) {
          try {
            await (layer.handler as RequestHandler)(req, res, next);
          } catch (e) {
            next(e);
          }
          return;
        }
      }

      return next();
    };

    next();
  }
}

export function Router(): RouterInstance {
  return new RouterInstance();
}

export class ExpressApp extends RouterInstance {
  public handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const extendedReq = req as Request;
    const extendedRes = res as Response;

    // Enhance response object
    extendedRes.status = function (code: number) {
      this.statusCode = code;
      return this;
    };

    extendedRes.json = function (data: any) {
      if (!this.getHeader('Content-Type')) {
        this.setHeader('Content-Type', 'application/json');
      }
      const jsonStr = JSON.stringify(data);
      this.end(jsonStr);
    };

    extendedRes.send = function (data: any) {
      if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
        this.json(data);
      } else {
        this.end(data);
      }
    };

    // Enhance request object
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    extendedReq.path = urlObj.pathname;
    extendedReq.originalUrl = req.url || '/';

    const query: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    extendedReq.query = query;
    extendedReq.params = {};

    this.handle(extendedReq, extendedRes, urlObj.pathname, (err) => {
      if (extendedRes.writableEnded) return;

      if (err) {
        extendedRes.status(500).json({
          success: false,
          error: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Internal Server Error',
          statusCode: 500,
          timestamp: new Date().toISOString()
        });
      } else {
        extendedRes.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: `Cannot ${req.method} ${urlObj.pathname}`,
          statusCode: 404,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  public async dispatch(request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  }): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    return new Promise(resolve => {
      let statusCode = 200;
      const resHeaders: Record<string, string> = {};
      let responseBody: any = null;
      let ended = false;

      const urlObj = new URL(request.url, 'http://localhost');
      const query: Record<string, string> = {};
      urlObj.searchParams.forEach((v, k) => {
        query[k] = v;
      });

      const req: Request = {
        method: (request.method || 'GET').toUpperCase(),
        url: request.url,
        headers: request.headers || {},
        body: request.body !== undefined ? request.body : {},
        query,
        params: {},
        path: urlObj.pathname,
        originalUrl: request.url,
        on: () => req,
        pipe: () => req
      } as any;

      const res: Response = {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        on: () => res,
        once: () => res,
        emit: () => true,
        status(code: number) {
          statusCode = code;
          this.statusCode = code;
          return this;
        },
        setHeader(name: string, value: string) {
          resHeaders[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return resHeaders[name.toLowerCase()];
        },
        json(data: any) {
          if (ended) return;
          ended = true;
          this.writableEnded = true;
          resHeaders['content-type'] = 'application/json';
          responseBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: responseBody });
        },
        send(data: any) {
          if (ended) return;
          ended = true;
          this.writableEnded = true;
          if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
            this.json(data);
          } else {
            try {
              responseBody = JSON.parse(data);
            } catch {
              responseBody = data;
            }
            resolve({ status: statusCode, headers: resHeaders, body: responseBody });
          }
        },
        end(data?: any) {
          if (ended) return;
          ended = true;
          this.writableEnded = true;
          if (data) {
            try {
              responseBody = JSON.parse(data);
            } catch {
              responseBody = data;
            }
          }
          resolve({ status: statusCode, headers: resHeaders, body: responseBody });
        }
      } as any;

      this.handle(req, res, urlObj.pathname, err => {
        if (ended) return;
        if (err) {
          res.status(500).json({
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: err.message || 'Internal Server Error',
            statusCode: 500,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: `Cannot ${req.method} ${urlObj.pathname}`,
            statusCode: 404,
            timestamp: new Date().toISOString()
          });
        }
      });
    });
  }

  public listen(port: number, callback?: () => void): http.Server {
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    return server.listen(port, callback);
  }

  /**
   * Serves over TLS.
   *
   * Browsers gate getUserMedia and SpeechRecognition behind a secure context,
   * and localhost is the only exception. Reaching the app from a phone on the
   * LAN therefore silently loses both the camera and hands-free voice entry —
   * the latter being the whole point on a shop floor, where an inspector is
   * holding a gauge and should not have to put it down to type.
   *
   * A self-signed certificate is enough: the phone shows a warning once, and
   * every browser API works afterwards.
   */
  public listenTls(
    port: number,
    tls: { key: string | Buffer; cert: string | Buffer },
    callback?: () => void
  ): https.Server {
    const server = https.createServer(tls, (req, res) => this.handleRequest(req, res));
    return server.listen(port, callback);
  }
}

export function express(): ExpressApp {
  return new ExpressApp();
}

/**
 * Parses a body-size limit like '10mb' into bytes.
 *
 * The limit option was previously accepted and then ignored — express.json()
 * took `{ limit: '10mb' }` and never checked anything, so the server would
 * buffer a body of any size into memory. With defect photos arriving as
 * base64 that is both a stability risk and an easy way to exhaust the host.
 */
function parseByteLimit(limit: string | undefined, fallbackBytes: number): number {
  if (!limit) return fallbackBytes;
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
  if (!m) return fallbackBytes;
  const value = parseFloat(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.floor(value * mult);
}

express.json = (options?: { limit?: string }) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.body !== undefined && Object.keys(req.body).length > 0) {
      return next();
    }

    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE' || req.method === 'OPTIONS') {
      req.body = req.body || {};
      return next();
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json') && contentType !== '') {
      req.body = req.body || {};
      return next();
    }

    const maxBytes = parseByteLimit(options?.limit, 10 * 1024 * 1024);
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        res.status(413).json({
          success: false,
          error: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds the ${options?.limit || '10mb'} limit.`,
          statusCode: 413,
          timestamp: new Date().toISOString()
        });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        req.body = {};
        return next();
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = JSON.parse(raw);
        next();
      } catch (e: any) {
        res.status(400).json({
          success: false,
          error: 'INVALID_JSON',
          message: 'Invalid JSON payload received',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
      }
    });

    req.on('error', err => next(err));
  };
};

express.urlencoded = (options?: { extended?: boolean; limit?: string }) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.body !== undefined) {
      return next();
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      req.body = {};
      return next();
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/x-www-form-urlencoded')) {
      return next();
    }

    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(raw);
      const body: Record<string, string> = {};
      params.forEach((v, k) => { body[k] = v; });
      req.body = body;
      next();
    });
    req.on('error', err => next(err));
  };
};

export function cors(options?: any) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-OTP-Token, X-Request-ID');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    next();
  };
}

import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

express.static = (rootPath: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const reqPath = req.path || '/';
    let safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/') safePath = '/index.html';

    let filePath = path.join(rootPath, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return;
    }

    next();
  };
};

export default express;

