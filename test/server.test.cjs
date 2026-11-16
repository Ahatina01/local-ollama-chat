const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, normalizeModels, readHistory, writeHistory } = require('../server.js');

test('normalizes installed model tags', () => {
  assert.deepEqual(normalizeModels({ models: [{ name: 'qwen3:4b-instruct' }] }), ['qwen3:4b-instruct']);
});

test('loads private Ollama paths from a local config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-'));
  const file = path.join(dir, 'config.local.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ ollamaExe: 'C:/private/ollama.exe', modelsDirectory: 'D:/private/models' }));
    assert.deepEqual(loadConfig(file, {}), { ollamaExe: 'C:/private/ollama.exe', modelsDirectory: 'D:/private/models' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('environment paths override private local config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-'));
  const file = path.join(dir, 'config.local.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ ollamaExe: 'local.exe', modelsDirectory: 'local-models' }));
    assert.deepEqual(loadConfig(file, { OLLAMA_EXE: 'env.exe', OLLAMA_MODELS: 'env-models' }), { ollamaExe: 'env.exe', modelsDirectory: 'env-models' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persists and reads conversation history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-'));
  const file = path.join(dir, 'history.json');
  const history = [{ id: 'c1', title: 'Hello', model: 'qwen3:4b-instruct', messages: [{ role: 'user', content: 'Hello' }] }];
  try {
    writeHistory(file, history);
    assert.deepEqual(readHistory(file), history);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

