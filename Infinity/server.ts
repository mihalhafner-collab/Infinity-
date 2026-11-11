import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  COLLECTION_NAMES,
  MCP_TOOLS,
  callMcpTool,
  getAdminOverview,
  getMcpConfig,
  getStore,
  isCollectionName,
  isValidAdminToken,
  queryCollection,
  recordMcpAccess,
  rotateMcpToken,
  saveStore,
  subscribeStoreChanges
} from './src/server/mcpAdminEngine.ts';
import type { AppDataSnapshot } from './src/server/mcpAdminEngine.ts';

dotenv.config();

function resolveListenPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx >= 0 && process.argv[portArgIdx + 1]) {
    const parsed = Number(process.argv[portArgIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveListenPort();

function isLocalHostname(host: string): boolean {
  const cleanHost = host.split(':')[0].trim().toLowerCase();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '[::1]';
}

function normalizeHttpsOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!isLocalHostname(parsed.host)) {
      parsed.protocol = 'https:';
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolvePublicHttpsBaseUrl(req: Request): {
  baseUrl: string;
  isPreviewEnvironment: boolean;
} {
  const explicitPublic = process.env.PUBLIC_MCP_BASE_URL?.trim();
  if (explicitPublic) {
    const normalized = normalizeHttpsOrigin(explicitPublic);
    if (normalized) {
      return {
        baseUrl: normalized,
        isPreviewEnvironment: normalized.includes('://ais-dev-')
      };
    }
  }

  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const reqHost = forwardedHost || req.get('host') || '';

  if (reqHost && !isLocalHostname(reqHost)) {
    // Public internet / Cloud Run hosts always use TLS (https://) externally,
    // even when internal container reverse proxies terminate TLS onto HTTP.
    const baseUrl = `https://${reqHost}`;
    return {
      baseUrl,
      isPreviewEnvironment: reqHost.toLowerCase().startsWith('ais-dev-')
    };
  }

  const appUrlEnv = process.env.APP_URL?.trim();
  if (appUrlEnv) {
    const normalized = normalizeHttpsOrigin(appUrlEnv);
    if (normalized) {
      return {
        baseUrl: normalized,
        isPreviewEnvironment: normalized.includes('://ais-dev-')
      };
    }
  }

  const fallbackHost = reqHost || `localhost:${PORT}`;
  const proto = isLocalHostname(fallbackHost) ? 'http' : 'https';
  return {
    baseUrl: `${proto}://${fallbackHost}`,
    isPreviewEnvironment: false
  };
}

function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const customHeader = req.headers['x-mcp-token'] || req.headers['x-admin-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  if (typeof req.params.token === 'string' && req.params.token.trim()) {
    return req.params.token.trim();
  }
  return null;
}

function applyNoLeakSecurityHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  const token = extractTokenFromRequest(req);
  if (!isValidAdminToken(token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="hafner-gruenraum-mcp"');
    res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32001,
        message:
          'Unauthorized: Fehlender oder ungültiger MCP-Schlüssel. Übergeben Sie Authorization: Bearer <TOKEN>.'
      }
    });
    return;
  }
  next();
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const SUPPORTED_MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

function handleSingleJsonRpc(payload: JsonRpcRequest): Record<string, unknown> | null {
  const isNotification = payload.id === undefined;
  const id = payload.id ?? null;
  const method = typeof payload.method === 'string' ? payload.method : '';
  const params = (
    payload.params && typeof payload.params === 'object' ? payload.params : {}
  ) as Record<string, unknown>;

  if (!method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: "method" fehlt.' }
    };
  }

  if (method.startsWith('notifications/')) {
    return null;
  }

  try {
    if (method === 'initialize') {
      const requestedVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
      const negotiated = (SUPPORTED_MCP_VERSIONS as readonly string[]).includes(requestedVersion)
        ? requestedVersion
        : '2025-03-26';
      recordMcpAccess('mcp:initialize');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          },
          serverInfo: {
            name: 'hafner-gruenraum-mcp',
            version: '1.1.0'
          },
          instructions:
            'Direkter MCP-Zugang (Lesen & Schreiben) für Hafner Grünraum Handwerk. Nutzt exakt dieselben gespeicherten App-Daten, Prüfungen, L.C.R.-Regeln, Rechnungsnummern und GuV-Berechnungen wie die App.'
        }
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      recordMcpAccess('mcp:tools/list');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const toolArgs =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const output = callMcpTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2)
              }
            ],
            isError: false
          }
        };
      } catch (toolErr: unknown) {
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ error: errMsg }) }],
            isError: true
          }
        };
      }
    }

    if (method === 'resources/list') {
      recordMcpAccess('mcp:resources/list');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'app://state/overview',
              name: 'Betriebsübersicht & GuV (Echtzeit)',
              mimeType: 'application/json',
              description:
                'Zusammenfassung aller Kunden, Termine, offenen Arbeiten, L.C.R.-Werte, Rechnungen und GuV.'
            },
            ...COLLECTION_NAMES.map((col) => ({
              uri: `app://collection/${col}`,
              name: `Collection: ${col}`,
              mimeType: 'application/json',
              description: `Alle gespeicherten Einträge aus ${col}`
            }))
          ]
        }
      };
    }

    if (method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { resourceTemplates: [] }
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      recordMcpAccess(`mcp:resources/read:${uri}`);
      if (uri === 'app://state/overview') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(getAdminOverview(true), null, 2)
              }
            ]
          }
        };
      }
      const prefix = 'app://collection/';
      if (uri.startsWith(prefix)) {
        const col = uri.slice(prefix.length);
        if (isCollectionName(col)) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(queryCollection({ collection: col }), null, 2)
                }
              ]
            }
          };
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unbekannte Resource-URI: ${uri}` }
      };
    }

    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { prompts: [] }
      };
    }

    if (isNotification) return null;

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Methode nicht gefunden: ${method}`
      }
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Interner MCP-Fehler';
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: msg
      }
    };
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // CORS for direct remote MCP connection from ChatGPT
  app.use((req, res, next) => {
    if (req.path.startsWith('/mcp')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-MCP-Token, X-Admin-Token, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, Accept'
      );
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.use(express.json({ limit: '30mb' }));

  // ==================== INTERNAL APP SYNC & MCP SETTINGS ROUTES ====================

  app.get('/api/internal/state', (_req, res) => {
    applyNoLeakSecurityHeaders(res);
    res.json(getStore());
  });

  app.put('/api/internal/state', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = req.body as { data?: AppDataSnapshot; summary?: string };
    if (!body || !body.data) {
      res.status(400).json({ error: 'Missing state data' });
      return;
    }
    const saved = saveStore(body.data, 'app', body.summary || 'App-Synchronisation');
    res.json({
      revision: saved.revision,
      updatedAt: saved.updatedAt
    });
  });

  app.get('/api/internal/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const current = getStore();
    res.write(
      `data: ${JSON.stringify({
        revision: current.revision,
        updatedAt: current.updatedAt,
        lastActor: current.lastActor,
        summary: current.lastActionSummary
      })}\n\n`
    );

    const unsubscribe = subscribeStoreChanges((updated) => {
      res.write(
        `data: ${JSON.stringify({
          revision: updated.revision,
          updatedAt: updated.updatedAt,
          lastActor: updated.lastActor,
          summary: updated.lastActionSummary
        })}\n\n`
      );
    });

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/internal/mcp-config', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const cfg = getMcpConfig();
    const store = getStore();
    const { baseUrl, isPreviewEnvironment } = resolvePublicHttpsBaseUrl(req);

    res.json({
      requireToken: true,
      tokenSource: cfg.tokenSource,
      adminToken: cfg.adminToken,
      createdAt: cfg.createdAt,
      lastAccessAt: cfg.lastAccessAt,
      lastOperation: cfg.lastOperation,
      totalCalls: cfg.totalCalls,
      revision: store.revision,
      toolCount: MCP_TOOLS.length,
      isPreviewEnvironment,
      endpoints: {
        baseUrl,
        mcpHeaderUrl: `${baseUrl}/mcp`,
        mcpSseHeaderUrl: `${baseUrl}/mcp/sse`,
        mcpDirectTokenUrl: `${baseUrl}/mcp/t/${cfg.adminToken}`
      }
    });
  });

  app.post('/api/internal/mcp-config', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = req.body as { rotate?: boolean };
    if (body?.rotate) {
      const rotated = rotateMcpToken();
      res.json({
        requireToken: true,
        tokenSource: rotated.tokenSource,
        createdAt: rotated.createdAt
      });
      return;
    }
    const cfg = getMcpConfig();
    res.json({
      requireToken: true,
      tokenSource: cfg.tokenSource,
      createdAt: cfg.createdAt
    });
  });

  app.get('/api/internal/mcp-health', (_req, res) => {
    applyNoLeakSecurityHeaders(res);
    const overview = getAdminOverview(false);
    const cfg = getMcpConfig();
    res.json({
      ok: true,
      protocolVersions: SUPPORTED_MCP_VERSIONS,
      authEnforced: true,
      tokenSource: cfg.tokenSource,
      accessMode: 'DIRECT_MCP_READ_WRITE',
      toolCount: MCP_TOOLS.length,
      collections: COLLECTION_NAMES,
      revision: overview.revision,
      counts: overview.counts,
      totalCalls: cfg.totalCalls,
      lastAccessAt: cfg.lastAccessAt
    });
  });

  // ==================== DIRECT MCP SERVER (STREAMABLE HTTP + SSE) ====================

  const sseSessions = new Map<string, Response>();

  const handleMcpPost = (req: Request, res: Response) => {
    const sessionId =
      (req.headers['mcp-session-id'] as string | undefined) || crypto.randomUUID();
    res.setHeader('Mcp-Session-Id', sessionId);
    res.setHeader('MCP-Protocol-Version', '2025-03-26');

    const body = req.body;
    if (Array.isArray(body)) {
      const responses = body
        .map((item) => handleSingleJsonRpc(item as JsonRpcRequest))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (responses.length === 0) {
        res.status(202).end();
        return;
      }
      res.json(responses);
      return;
    }

    const reply = handleSingleJsonRpc((body || {}) as JsonRpcRequest);
    if (reply === null) {
      res.status(202).end();
      return;
    }
    res.json(reply);
  };

  const handleMcpSseConnect = (req: Request, res: Response) => {
    const sessionId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Mcp-Session-Id', sessionId);
    res.flushHeaders?.();

    sseSessions.set(sessionId, res);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    const tokenPart = req.params.token ? `/t/${req.params.token}` : '';
    const messageEndpoint = `${baseUrl}/mcp${tokenPart}/messages?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseSessions.delete(sessionId);
    });
  };

  const handleMcpSseMessage = (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '');
    const sseRes = sseSessions.get(sessionId);
    const reply = handleSingleJsonRpc((req.body || {}) as JsonRpcRequest);

    if (sseRes && reply !== null) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      res.status(202).json({ accepted: true });
      return;
    }
    if (reply === null) {
      res.status(202).end();
      return;
    }
    res.json(reply);
  };

  app.post('/mcp', requireAdminAuth, handleMcpPost);
  app.post('/mcp/t/:token', requireAdminAuth, handleMcpPost);

  const handleMcpGet = (req: Request, res: Response) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream')) {
      handleMcpSseConnect(req, res);
      return;
    }
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    res.json({
      name: 'hafner-gruenraum-mcp',
      version: '1.1.0',
      endpoint: `${baseUrl}/mcp`,
      protocolVersions: SUPPORTED_MCP_VERSIONS,
      auth: 'Bearer token required',
      access: 'read_write_admin',
      toolCount: MCP_TOOLS.length,
      tools: MCP_TOOLS.map((t) => t.name)
    });
  };

  app.get('/mcp', requireAdminAuth, handleMcpGet);
  app.get('/mcp/t/:token', requireAdminAuth, handleMcpGet);

  app.delete('/mcp', requireAdminAuth, (_req, res) => {
    res.status(200).json({ closed: true });
  });
  app.delete('/mcp/t/:token', requireAdminAuth, (_req, res) => {
    res.status(200).json({ closed: true });
  });

  app.get('/mcp/sse', requireAdminAuth, handleMcpSseConnect);
  app.get('/mcp/t/:token/sse', requireAdminAuth, handleMcpSseConnect);
  app.post('/mcp/messages', requireAdminAuth, handleMcpSseMessage);
  app.post('/mcp/t/:token/messages', requireAdminAuth, handleMcpSseMessage);

  // ==================== VITE DEV MIDDLEWARE / PRODUCTION STATIC ====================

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hafner Gruenraum App & Protected MCP Server listening on 0.0.0.0:${PORT}`);
  });
}

void startServer();
