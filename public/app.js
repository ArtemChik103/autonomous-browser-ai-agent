// Mission Control Client App
(function () {
  'use strict';

  // Elements
  const connectionStatus = document.getElementById('connectionStatus');
  const taskInput = document.getElementById('taskInput');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const feedContainer = document.getElementById('feedContainer');
  const previewDrawer = document.getElementById('previewDrawer');
  const screenshotImg = document.getElementById('screenshotImg');
  const screenshotTimestamp = document.getElementById('screenshotTimestamp');
  const presetCards = document.querySelectorAll('.preset-card');

  let ws = null;
  let isAgentRunning = false;
  let reconnectTimer = null;

  // Formatting helpers
  function formatTime(date) {
    const d = date || new Date();
    return d.toTimeString().split(' ')[0];
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update Status Pill
  function setStatus(running, label) {
    isAgentRunning = running;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    taskInput.disabled = running;

    const statusText = connectionStatus.querySelector('.status-text');
    if (running) {
      connectionStatus.className = 'status-pill status-running';
      statusText.textContent = label || 'Выполняется задача...';
    } else {
      connectionStatus.className = 'status-pill status-idle';
      statusText.textContent = label || 'Готов к работе';
    }
  }

  // Append entry to feed
  function appendLog(type, title, body, isCode = false) {
    // Remove empty-state if present
    const emptyState = feedContainer.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const item = document.createElement('div');
    item.className = 'log-item';

    let tagClass = 'log-tag-thought';
    let tagText = 'THOUGHT';

    switch (type) {
      case 'tool':
        tagClass = 'log-tag-tool';
        tagText = 'TOOL';
        break;
      case 'subagent':
        tagClass = 'log-tag-subagent';
        tagText = 'DOM SUB-AGENT';
        break;
      case 'warning':
        tagClass = 'log-tag-warning';
        tagText = 'SECURITY GUARD';
        break;
      case 'finish':
        tagClass = 'log-tag-finish';
        tagText = 'COMPLETED';
        break;
      case 'error':
        tagClass = 'log-tag-warning';
        tagText = 'ERROR';
        break;
    }

    const header = document.createElement('div');
    header.className = 'log-header';
    header.innerHTML = `
      <span class="log-tag ${tagClass}">${tagText} ${escapeHtml(title)}</span>
      <span class="log-time">${formatTime()}</span>
    `;

    const content = document.createElement('div');
    if (isCode) {
      content.className = 'log-code';
      content.textContent = body;
    } else {
      content.className = 'log-body';
      content.innerHTML = escapeHtml(body).replace(/\n/g, '<br>');
    }

    item.appendChild(header);
    item.appendChild(content);
    feedContainer.appendChild(item);

    // Auto-scroll to bottom
    feedContainer.scrollTop = feedContainer.scrollHeight;
  }

  // Show screenshot in side drawer
  function updateScreenshot(url) {
    if (!url) return;
    previewDrawer.classList.remove('hidden');
    screenshotImg.src = url;
    screenshotTimestamp.textContent = formatTime();
  }

  // WebSocket Connection
  function connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleWsEvent(payload.event, payload.data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setStatus(false, 'Переподключение к серверу...');
      reconnectTimer = setTimeout(connectWs, 2000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket encountered error:', err);
    };
  }

  function handleWsEvent(event, data) {
    switch (event) {
      case 'init':
        setStatus(data.isRunning);
        break;

      case 'status':
        setStatus(data.isRunning, data.message);
        break;

      case 'thought':
        if (data.text) {
          appendLog('thought', 'Рассуждение Orchestrator', data.text);
        }
        break;

      case 'tool_start':
        appendLog('tool', `Вызов: ${data.name}`, JSON.stringify(data.input, null, 2), true);
        break;

      case 'tool_end':
        appendLog('tool', `Результат: ${data.name}`, data.result, false);
        if (data.screenshotUrl) {
          updateScreenshot(data.screenshotUrl);
        }
        break;

      case 'subagent_start':
        appendLog('subagent', 'Запрос к DOM Sub-Agent', `Вопрос: "${data.query}"`);
        break;

      case 'subagent_end':
        appendLog('subagent', 'Ответ DOM Sub-Agent', data.result, false);
        break;

      case 'security_warning':
        appendLog('warning', 'Блокировка действия', `Действие заблокировано Security Layer: ${data.reason}`);
        break;

      case 'finish': {
        let finishMsg = data.summary || 'Задача успешно выполнена';
        if (Array.isArray(data.items) && data.items.length > 0) {
          finishMsg += '\n\nВыполненные шаги:\n' + data.items.map(it => `• ${it}`).join('\n');
        }
        appendLog('finish', 'Финал задачи', finishMsg);
        setStatus(false, 'Задача завершена');
        break;
      }

      case 'error':
        appendLog('error', 'Критическая ошибка', data.message || 'Неизвестная ошибка');
        setStatus(false, 'Ошибка выполнения');
        break;
    }
  }

  // Action: Run Task
  async function runTask() {
    const task = taskInput.value.trim();
    if (!task) {
      taskInput.focus();
      return;
    }

    setStatus(true, 'Запуск агента...');
    appendLog('thought', 'Новая задача', task);

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ошибка запуска');
      }
    } catch (err) {
      appendLog('error', 'Ошибка запроса', err.message);
      setStatus(false, 'Ошибка запуска');
    }
  }

  // Action: Stop Task
  async function stopTask() {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error('Failed to send stop command:', err);
    }
  }

  // Preset Card Handlers
  presetCards.forEach((card) => {
    card.addEventListener('click', () => {
      const task = card.getAttribute('data-task');
      if (task) {
        taskInput.value = task;
        taskInput.focus();
      }
    });
  });

  // Buttons
  startBtn.addEventListener('click', runTask);
  stopBtn.addEventListener('click', stopTask);

  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runTask();
    }
  });

  clearLogBtn.addEventListener('click', () => {
    feedContainer.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <p>Лог очищен. Введите новую задачу или выберите сценарий слева.</p>
      </div>
    `;
    previewDrawer.classList.add('hidden');
    screenshotImg.src = '';
  });

  // Init
  connectWs();
})();
