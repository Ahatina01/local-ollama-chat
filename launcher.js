const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = __dirname;
const host = '127.0.0.1';
const port = Number(process.env.OLLAMA_CHAT_PORT || 4173);
const url = `http://${host}:${port}/`;
function check() {
  return new Promise((resolve) => {
    const request = http.get(`${url}api/history`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(900, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
(async () => {
  if (!(await check())) {
    const log = fs.openSync(path.join(root, 'app-server.log'), 'a');
    const server = spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1' },
    });
    server.unref();
    fs.closeSync(log);
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await check()) { ready = true; break; }
      await delay(500);
    }
    if (!ready) throw new Error('Сервер не запустился. Откройте app-server.log и ollama-server.log.');
  }
  const browser = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, windowsHide: true, stdio: 'ignore' });
  browser.unref();
  console.log(`Открыт локальный чат: ${url}`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

