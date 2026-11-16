const chatList = document.querySelector('#chatList');
const messagesBox = document.querySelector('#messages');
const welcome = document.querySelector('#welcome');
const conversation = document.querySelector('#conversation');
const modelSelect = document.querySelector('#modelSelect');
const promptBox = document.querySelector('#prompt');
const sendButton = document.querySelector('#sendButton');
let history = [];
let activeId = null;
let models = [];
let busy = false;
let saveTimer;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatText(text) {
  return escapeHtml(text).replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function currentChat() { return history.find((chat) => chat.id === activeId); }
function render() {
  const chat = currentChat();
  chatList.replaceChildren();
  [...history].sort((a, b) => b.updatedAt - a.updatedAt).forEach((item) => {
    const button = document.createElement('button');
    button.className = `chat-item${item.id === activeId ? ' active' : ''}`;
    button.textContent = item.title || 'Новый чат';
    button.title = item.title || 'Новый чат';
    button.addEventListener('click', () => { activeId = item.id; render(); });
    chatList.append(button);
  });
  messagesBox.replaceChildren();
  if (!chat || chat.messages.length === 0) {
    welcome.hidden = false;
  } else {
    welcome.hidden = true;
    for (const message of chat.messages) {
      const row = document.createElement('article');
      row.className = `message ${message.role}`;
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = message.role === 'user' ? 'Вы' : '◉';
      const body = document.createElement('div');
      body.className = 'message-content';
      const role = document.createElement('div');
      role.className = 'message-role';
      role.textContent = message.role === 'user' ? 'Вы' : 'Ollama';
      const text = document.createElement('div');
      text.className = 'message-text';
      text.innerHTML = formatText(message.content || '');
      body.append(role, text);
      row.append(avatar, body);
      messagesBox.append(row);
    }
    conversation.scrollTop = conversation.scrollHeight;
  }
  modelSelect.value = chat?.model || modelSelect.value;
  promptBox.disabled = busy;
  sendButton.disabled = busy || !promptBox.value.trim() || models.length === 0;
}
async function saveHistory() {
  try {
    const response = await fetch('/api/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history }) });
    if (!response.ok) throw new Error('Не удалось сохранить историю');
  } catch (error) { showToast(error.message); }
}
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveHistory, 350);
}
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 4500);
}
function newChat() {
  const chat = { id: crypto.randomUUID(), title: 'Новый чат', model: modelSelect.value || models[0] || '', messages: [], updatedAt: Date.now() };
  history.push(chat);
  activeId = chat.id;
  render();
  queueSave();
  promptBox.focus();
}
async function loadModels() {
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ollama не ответила');
    models = data.models || [];
    modelSelect.replaceChildren();
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.append(option);
    });
    if (!models.length) {
      modelSelect.append(new Option('Модели не найдены', ''));
      showToast('В каталоге Ollama пока нет моделей');
    } else if (!currentChat()) newChat();
    render();
  } catch (error) {
    modelSelect.replaceChildren(new Option('Ollama недоступна', ''));
    showToast(error.message);
  }
}
async function loadHistory() {
  try {
    const response = await fetch('/api/history');
    history = await response.json();
    history.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    activeId = history[0]?.id || null;
  } catch { history = []; }
}
async function sendMessage(event) {
  event?.preventDefault();
  const content = promptBox.value.trim();
  const model = modelSelect.value;
  if (!content || busy || !model) return;
  if (!currentChat()) newChat();
  const chat = currentChat();
  chat.model = model;
  chat.messages.push({ role: 'user', content });
  if (chat.title === 'Новый чат') chat.title = content.length > 48 ? `${content.slice(0, 48)}…` : content;
  chat.updatedAt = Date.now();
  promptBox.value = '';
  promptBox.style.height = 'auto';
  chat.messages.push({ role: 'assistant', content: '' });
  busy = true;
  render();
  queueSave();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: chat.messages.slice(0, -1) }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка генерации');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        chat.messages[chat.messages.length - 1].content += chunk.message?.content || '';
        render();
        queueSave();
      }
      if (done) break;
    }
    if (pending.trim()) {
      const chunk = JSON.parse(pending);
      chat.messages[chat.messages.length - 1].content += chunk.message?.content || '';
    }
    chat.updatedAt = Date.now();
  } catch (error) {
    const answer = chat.messages[chat.messages.length - 1];
    answer.content = answer.content ? `${answer.content}\n\nОшибка: ${error.message}` : `Ошибка: ${error.message}`;
  } finally {
    busy = false;
    render();
    queueSave();
    promptBox.focus();
  }
}

document.querySelector('#newChat').addEventListener('click', newChat);
document.querySelector('#chatForm').addEventListener('submit', sendMessage);
modelSelect.addEventListener('change', () => { const chat = currentChat(); if (chat) { chat.model = modelSelect.value; queueSave(); } });
promptBox.addEventListener('input', () => { promptBox.style.height = 'auto'; promptBox.style.height = `${Math.min(promptBox.scrollHeight, 180)}px`; render(); });
promptBox.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
(async () => { await loadHistory(); await loadModels(); render(); })();

