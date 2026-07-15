import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import 'dotenv/config';
import { startIncidentPipeline, approveIncident, rejectIncident, summarize } from './orchestrator';
import { getIncident, listIncidents, subscribe } from './store';
import { Alert, RawAlertInput } from './types';
import { isMockMode } from './qwenClient';

const app = express();
// Alibaba Cloud Function Compute custom runtime routes traffic to port 9000.
const PORT = Number(process.env.PORT) || 9000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[Server] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Health & dashboard
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'SentinelOps-Society',
    version: '2.0.0',
    mode: isMockMode() ? 'mock' : 'live',
    model: process.env.QWEN_MODEL || 'qwen-plus',
  });
});

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Incident ingestion — accepts BOTH structured alerts and raw ambiguous text
// (monitoring email, Slack message, webhook payload...)
// ---------------------------------------------------------------------------

app.post('/incident', (req: Request, res: Response) => {
  const { alert, rawText, source } = req.body as { alert?: Partial<Alert>; rawText?: string; source?: string };

  let input: Alert | RawAlertInput;
  if (rawText && String(rawText).trim()) {
    input = { rawText: String(rawText), source };
  } else if (alert && alert.message && alert.service) {
    input = {
      id: alert.id || `ALT-${Date.now()}`,
      service: alert.service,
      message: alert.message,
      timestamp: alert.timestamp || new Date().toISOString(),
      severity: alert.severity || 'P2',
      source: alert.source || 'api',
    };
  } else {
    res.status(400).json({
      error: 'Fournir soit { "rawText": "..." } (alerte non structuree), soit { "alert": { "service", "message", ... } }.',
    });
    return;
  }

  // Fire-and-observe: the record (and its id) is created synchronously; the
  // pipeline runs in the background. Clients follow it live via SSE
  // (/incident/:id/events) or by polling GET /incident/:id.
  const record = startIncidentPipeline(input);
  res.status(202).json({
    incidentId: record.incidentId,
    status: record.status,
    streamUrl: `/incident/${record.incidentId}/events`,
    detailUrl: `/incident/${record.incidentId}`,
  });
});

// ---------------------------------------------------------------------------
// Incident queries
// ---------------------------------------------------------------------------

app.get('/incidents', (_req: Request, res: Response) => {
  res.json(listIncidents().map(summarize));
});

app.get('/incident/:id', (req: Request, res: Response) => {
  const record = getIncident(req.params.id);
  if (!record) { res.status(404).json({ error: `Incident inconnu: ${req.params.id}` }); return; }
  res.json(record);
});

// ---------------------------------------------------------------------------
// Live event stream (SSE) — replay past timeline, then stream new events
// ---------------------------------------------------------------------------

app.get('/incident/:id/events', (req: Request, res: Response) => {
  const record = getIncident(req.params.id);
  if (!record) { res.status(404).json({ error: `Incident inconnu: ${req.params.id}` }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  // Replay history so late subscribers see the full timeline.
  for (const entry of record.context.timeline) send('timeline', entry);
  send('status', record.status);
  if (['resolved', 'rejected', 'pending_approval', 'failed'].includes(record.status)) {
    send('done', summarize(record));
  }

  const unsubscribe = subscribe(req.params.id, (event) => send(event.type, event.data));
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// Human-in-the-loop checkpoint — DSI/RSSI decision endpoints
// ---------------------------------------------------------------------------

app.post('/incident/:id/approve', async (req: Request, res: Response) => {
  try {
    const approver = String(req.body?.approver || 'DSI');
    const record = await approveIncident(req.params.id, approver);
    res.json({ message: 'Remediation approuvee et executee.', ...summarize(record), report: record.context.postIncidentReport });
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

app.post('/incident/:id/reject', async (req: Request, res: Response) => {
  try {
    const approver = String(req.body?.approver || 'DSI');
    const reason = String(req.body?.reason || '');
    const record = await rejectIncident(req.params.id, approver, reason);
    res.json({ message: 'Remediation refusee. Rapport genere.', ...summarize(record), report: record.context.postIncidentReport });
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Server initialization — Alibaba Cloud Function Compute (custom runtime)
// simply runs this process and routes HTTP traffic to PORT (9000).
// ---------------------------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] SentinelOps Society v2 running on port ${PORT} (${isMockMode() ? 'MOCK' : 'LIVE'} mode)`);
  console.log(`[Server] Dashboard: http://localhost:${PORT}`);
});

export default app;
