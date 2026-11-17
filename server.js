const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.OLLAMA_CHAT_PORT || 4173);
const OLLAMA_URL = 'http://127.0.0.1:11434';
const APP_DIR = __dirname;
const HISTORY_FILE = path.join(APP_DIR, 'history.json');
const INDEX_FILE = path.join(APP_DIR, 'index.html');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function loadConfig(configFile = path.join(APP_DIR, 'config.local.json'), env = process.env) {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    ollamaExe: env.OLLAMA_EXE || local.ollamaExe || 'ollama',
    modelsDirectory: env.OLLAMA_MODELS || local.modelsDirectory || path.join(os.homedir(), '.ollama', 'models'),
  };
}

function normalizeModels(payload) {
  return (Array.isArray(payload?.models) ? payload.models : [])
    .map((model) => model?.name)
    .filter((name) => typeof name === 'string' && name.length > 0);
}

function normalizeChatOptions(options = {}) {
  const safe = {};
  if (Number.isInteger(options.num_ctx) && options.num_ctx >= 4096 && options.num_ctx <= 65536) {
    safe.num_ctx = options.num_ctx;
  }
  if (Number.isInteger(options.num_predict) && options.num_predict >= 1 && options.num_predict <= 4096) {
    safe.num_predict = options.num_predict;
  }
  return safe;
}

function readHistory(file = HISTORY_FILE) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const value = JSON.parse(content);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeHistory(file, history) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(history, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

async function ollamaReachable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllama() {
  if (await ollamaReachable()) return false;
  const config = loadConfig();
  if (path.isAbsolute(config.ollamaExe) && !fs.existsSync(config.ollamaExe)) {
    throw new Error(`Не найден Ollama: ${config.ollamaExe}`);
  }
  const logPath = path.join(APP_DIR, 'ollama-server.log');
  const log = fs.openSync(logPath, 'a');
  const child = spawn(config.ollamaExe, ['serve'], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      OLLAMA_HOST: '127.0.0.1:11434',
      OLLAMA_MODELS: config.modelsDirectory,
      OLLAMA_NO_CLOUD: '1',
    },
  });
  child.unref();
  fs.closeSync(log);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ollamaReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Ollama не запустился. Подробности: ${logPath}`);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = '';
  for await (const part of request) {
    body += part;
    if (body.length > 8_000_000) throw new Error('Запрос слишком большой');
  }
  return body ? JSON.parse(body) : {};
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (request.method === 'GET' && url.pathname === '/api/history') {
    return sendJson(response, 200, readHistory());
  }
  if (request.method === 'PUT' && url.pathname === '/api/history') {
    const body = await readBody(request);
    if (!Array.isArray(body.history)) return sendJson(response, 400, { error: 'history должен быть списком' });
    writeHistory(HISTORY_FILE, body.history);
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/api/models') {
    const upstream = await fetch(`${OLLAMA_URL}/api/tags`);
    const payload = await upstream.json();
    if (!upstream.ok) return sendJson(response, upstream.status, payload);
    return sendJson(response, 200, { models: normalizeModels(payload) });
  }
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readBody(request);
    if (typeof body.model !== 'string' || !Array.isArray(body.messages)) {
      return sendJson(response, 400, { error: 'Нужны model и messages' });
    }
    const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        options: normalizeChatOptions(body.options),
        stream: true,
      }),
    });
    if (!upstream.ok) {
      const message = await upstream.text();
      return sendJson(response, upstream.status, { error: message || 'Ошибка Ollama' });
    }
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
    return;
  }

  const file = url.pathname === '/' ? INDEX_FILE : path.join(APP_DIR, path.basename(url.pathname));
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    return response.end('Not found');
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(response);
}

function createServer() {
  return http.createServer((request, response) => {
    Promise.resolve(handle(request, response)).catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { error: error.message });
      else response.destroy(error);
    });
  });
}

if (require.main === module) {
  ensureOllama().then((startedOllama) => {
    const server = createServer();
    server.listen(PORT, HOST, () => {
      console.log(`Локальный чат: http://${HOST}:${PORT}`);
      console.log(startedOllama
        ? 'Ollama запущена приложением с OLLAMA_NO_CLOUD=1.'
        : 'Используется уже запущенный локальный сервер Ollama.');
    });
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadConfig, normalizeModels, normalizeChatOptions, readHistory, writeHistory, createServer };

