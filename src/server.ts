import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { runOrchestrator } from './orchestrator';
import { Alert } from './types';

const app = express();
const PORT = process.env.PORT || 9000;

// Middleware
app.use(express.json());
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

// Routes
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'SentinelOps-Society', version: '1.0.0' });
});

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.post('/incident', async (req: Request, res: Response) => {
  try {
    const { alert } = req.body as { alert: Alert };
    if (!alert || !alert.message || !alert.service) {
      res.status(400).json({ error: 'Champs requis: alert.message, alert.service' });
      return;
    }
    const alertWithDefaults: Alert = {
      id: alert.id || `ALT-${Date.now()}`,
      service: alert.service,
      message: alert.message,
      timestamp: alert.timestamp || new Date().toISOString(),
      severity: alert.severity || 'P2',
    };
    console.log(`[Server] Processing incident for service: ${alertWithDefaults.service}`);
    const result = await runOrchestrator(alertWithDefaults);
    res.json(result);
  } catch (error: any) {
    console.error('[Server] Error processing incident:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Alibaba Cloud Function Compute handler
module.exports.handler = (req: any, resp: any, context: any) => {
  app(req, resp);
};

// Local dev server
if (process.env.NODE_ENV !== 'fc') {
  app.listen(PORT, () => {
    console.log(`[Server] SentinelOps Society running on port ${PORT}`);
    console.log(`[Server] Dashboard: http://localhost:${PORT}`);
  });
}

export default app;
