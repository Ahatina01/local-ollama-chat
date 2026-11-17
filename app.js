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
const LONG_TEXT_THRESHOLD_CHARS = 4500;
const DOCUMENT_CHUNK_CHARS = 4500;
const DOCUMENT_CHUNK_OVERLAP = 250;
const CHAT_OPTIONS = { num_ctx: 8192, num_predict: 1800 };
const CHUNK_OPTIONS = { num_ctx: 8192, num_predict: 500 };

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
  modelSelect.disabled = busy;
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
function setProgress(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.classList.add('show');
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

async function requestChat(model, messages, options, onText = () => {}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, options }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Ошибка генерации');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result = '';
  const consume = (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(chunk.error);
    const text = chunk.message?.content || '';
    result += text;
    if (text) onText(text);
  };
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (pending.trim()) consume(pending);
  return result;
}

async function compactPartNotes(notes, model) {
  let level = notes;
  while (level.length > 4) {
    const next = [];
    for (let index = 0; index < level.length; index += 5) {
      const group = level.slice(index, index + 5);
      setProgress(`Собираю выводы по частям: ${Math.min(index + group.length, level.length)} из ${level.length}…`);
      const summary = await requestChat(model, [
        { role: 'system', content: 'Сожми заметки по частям документа в точный промежуточный конспект. Сохрани конкретные факты, имена, числа, причинно-следственные связи, противоречия и номера частей. Ничего не додумывай. До 450 слов.' },
        { role: 'user', content: group.join('\n\n') },
      ], { num_ctx: 8192, num_predict: 650 });
      next.push(summary.trim());
    }
    level = next;
  }
  return level;
}

async function analyzeLongText(source, chat, model, answer) {
  const chunks = OllamaChatUtils.splitLongText(source, { maxChars: DOCUMENT_CHUNK_CHARS, overlap: DOCUMENT_CHUNK_OVERLAP });
  const notes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const current = chunks[index];
    setProgress(`Разбираю длинный текст: часть ${index + 1} из ${chunks.length}…`);
    answer.content = `Идёт полный разбор документа… ${index + 1}/${chunks.length}`;
    render();
    queueSave();
    const taskReminder = index > 0 && notes[0]
      ? `\nЗадача/начальный контекст из первой части:\n${notes[0].slice(0, 1200)}`
      : '';
    const previousContext = index === 0 && chat.documentSummary
      ? `\nКраткий контекст предыдущего разбора в этом чате:\n${chat.documentSummary.slice(0, 2000)}`
      : '';
    const note = await requestChat(model, [
      {
        role: 'system',
        content: `Ты внимательно анализируешь фрагмент ${index + 1} из ${chunks.length} одного длинного документа. На первом фрагменте определи, есть ли в начале отдельная задача пользователя, и отрази её в заметках. Сохраняй важные факты, имена, даты, числа, аргументы, причинные связи и неоднозначности. Не выдумывай и не повторяй текст целиком. На последующих фрагментах держись задачи из первой части. Это промежуточные заметки для итогового полного и понятного разбора.${taskReminder}${previousContext}`,
      },
      { role: 'user', content: current.text },
    ], CHUNK_OPTIONS);
    notes.push(`Часть ${index + 1}/${chunks.length}:\n${note.trim()}`);
  }

  const compactNotes = await compactPartNotes(notes, model);
  chat.documentSummary = compactNotes.join('\n\n').slice(0, 5000);
  answer.content = '';
  render();
  setProgress('Объединяю части в полный разбор…');
  await requestChat(model, [
    {
      role: 'system',
      content: 'Подготовь полный, подробный и понятный разбор длинного текста по заметкам всех его частей. Выполни задачу пользователя, если она отражена в заметках. Объедини повторяющиеся темы, сохрани существенные конкретные детали, отделяй факты от выводов, отмечай противоречия и неопределённость. Не утверждай, что видел исходный текст целиком: работай по заметкам частей.',
    },
    { role: 'user', content: compactNotes.join('\n\n') },
  ], { num_ctx: 8192, num_predict: 1800 }, (delta) => {
    answer.content += delta;
    render();
    queueSave();
  });
  if (!answer.content.trim()) throw new Error('Модель не вернула итоговый разбор.');
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
  const answer = chat.messages[chat.messages.length - 1];
  busy = true;
  render();
  queueSave();
  try {
    if (content.length >= LONG_TEXT_THRESHOLD_CHARS) {
      await analyzeLongText(content, chat, model, answer);
      showToast('Готово — все части разобраны и объединены.');
    } else {
      const context = OllamaChatUtils.buildConversationMessages(
        chat.messages.slice(0, -1),
        chat.documentSummary || '',
      );
      await requestChat(model, context, CHAT_OPTIONS, (delta) => {
        answer.content += delta;
        render();
        queueSave();
      });
    }
    chat.updatedAt = Date.now();
  } catch (error) {
    answer.content = answer.content ? `${answer.content}\n\nОшибка: ${error.message}` : `Ошибка: ${error.message}`;
    showToast(error.message);
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

