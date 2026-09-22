import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { BrowserManager } from '../browser/browser-manager.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { config } from '../config.js';

export function startWebServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());
  app.use(express.static(path.resolve('./public')));
  app.use('/screenshots', express.static(path.resolve('./screenshots')));

  let activeBrowser: BrowserManager | null = null;
  let activeAgent: OrchestratorAgent | null = null;
  let isRunning = false;

  const broadcast = (event: string, data: any) => {
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      event: 'init',
      data: {
        isRunning,
        model: config.orchestratorModel,
        headless: config.headless
      }
    }));
  });

  app.post('/api/run', async (req, res) => {
    const { task } = req.body;
    if (!task) {
      return res.status(400).json({ error: 'Поле task обязательно' });
    }

    if (isRunning) {
      return res.status(409).json({ error: 'Агент уже выполняет задачу' });
    }

    isRunning = true;
    broadcast('status', { isRunning: true, task });

    res.json({ success: true, message: 'Задача запущена' });

    try {
      if (!activeBrowser) {
        activeBrowser = new BrowserManager();
      }

      activeAgent = new OrchestratorAgent(activeBrowser, {
        onAssistantThought(text) {
          broadcast('thought', { text });
        },
        onToolStart(name, input) {
          broadcast('tool_start', { name, input });
        },
        onToolEnd(name, result) {
          let screenshotUrl: string | undefined;
          if (name === 'take_screenshot' && result.includes('Screenshot saved as ')) {
            const filename = result.split('Screenshot saved as ')[1].trim();
            screenshotUrl = `/screenshots/${filename}`;
          }
          broadcast('tool_end', { name, result, screenshotUrl });
        },
        onSubAgentStart(query) {
          broadcast('subagent_start', { query });
        },
        onSubAgentEnd(result) {
          broadcast('subagent_end', { result });
        },
        onSecurityWarning(reason) {
          broadcast('security_warning', { reason });
        },
        onFinish(summary, items) {
          broadcast('finish', { summary, items });
        }
      });

      await activeAgent.run(task);
    } catch (err: any) {
      broadcast('error', { message: err.message });
    } finally {
      isRunning = false;
      broadcast('status', { isRunning: false });
    }
  });

  app.post('/api/stop', async (_req, res) => {
    if (activeBrowser) {
      await activeBrowser.close();
      activeBrowser = null;
    }
    isRunning = false;
    broadcast('status', { isRunning: false, message: 'Выполнение остановлено пользователем' });
    res.json({ success: true });
  });

  const PORT = config.port;
  server.listen(PORT, () => {
    console.log(`\nВеб-интерфейс запущен: http://localhost:${PORT}`);
    console.log(`Для остановки нажмите Ctrl+C\n`);
  });
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startWebServer();
}
