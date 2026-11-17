(function exposeUtilities(root, factory) {
  const utilities = factory();
  if (typeof module === 'object' && module.exports) module.exports = utilities;
  else root.OllamaChatUtils = utilities;
})(typeof globalThis === 'object' ? globalThis : this, function createUtilities() {
  function splitLongText(source, options = {}) {
    if (typeof source !== 'string') throw new TypeError('source must be text');
    if (!source.length) return [];
    const maxChars = Math.max(100, Math.floor(options.maxChars || 4500));
    const overlap = Math.max(0, Math.min(Math.floor(options.overlap ?? 250), Math.floor(maxChars / 3)));
    const chunks = [];
    let start = 0;

    while (start < source.length) {
      const hardEnd = Math.min(start + maxChars, source.length);
      let end = hardEnd;
      if (hardEnd < source.length) {
        const minimumBoundary = start + Math.floor(maxChars * 0.55);
        const paragraph = source.lastIndexOf('\n\n', hardEnd);
        const line = source.lastIndexOf('\n', hardEnd);
        const space = source.lastIndexOf(' ', hardEnd);
        const boundary = paragraph >= minimumBoundary ? paragraph + 2
          : line >= minimumBoundary ? line + 1
            : space >= minimumBoundary ? space + 1 : -1;
        if (boundary > start) end = Math.min(boundary, hardEnd);
      }
      chunks.push({ text: source.slice(start, end), start, end });
      if (end >= source.length) break;
      const nextStart = Math.max(start + 1, end - overlap);
      start = nextStart;
    }
    return chunks;
  }

  function buildConversationMessages(messages, documentSummary = '', options = {}) {
    const maxChars = Math.max(1000, Math.floor(options.maxChars || 6000));
    const maxMessages = Math.max(1, Math.floor(options.maxMessages || 8));
    const maxSummaryChars = Math.max(0, Math.floor(options.maxSummaryChars ?? 3000));
    const selected = [];
    let usedChars = 0;

    for (let index = messages.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
      const message = messages[index];
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content) continue;
      if (message.content.length > maxChars) continue;
      if (usedChars + message.content.length > maxChars) continue;
      selected.unshift({ role: message.role, content: message.content });
      usedChars += message.content.length;
    }

    const context = [];
    if (documentSummary) {
      context.push({
        role: 'system',
        content: `Контекст ранее разобранного документа. Используй его для уточняющих вопросов; не утверждай то, чего в заметках нет.\n\n${documentSummary.slice(0, maxSummaryChars)}`,
      });
    }
    return context.concat(selected);
  }

  return { splitLongText, buildConversationMessages };
});

