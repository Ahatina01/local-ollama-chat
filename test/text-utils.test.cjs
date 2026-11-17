const test = require('node:test');
const assert = require('node:assert/strict');
const { splitLongText, buildConversationMessages } = require('../text-utils.js');

test('splits a long document into bounded overlapping chunks without losing source ranges', () => {
  const source = `${'А'.repeat(6100)}\n${'Б'.repeat(6100)}\n${'В'.repeat(6100)}`;
  const chunks = splitLongText(source, { maxChars: 3000, overlap: 250 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 3000));
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, source.length);
  assert.ok(chunks.slice(1).every((chunk, index) => chunk.start < chunks[index].end));
  assert.ok(chunks.every((chunk) => source.slice(chunk.start, chunk.end) === chunk.text));
});

test('keeps the follow-up context compact and replaces the original long document with its analysis notes', () => {
  const longDocument = 'ЧАСТНЫЙ ТЕКСТ '.repeat(1000);
  const messages = [
    { role: 'user', content: longDocument },
    { role: 'assistant', content: 'Краткий итог документа.' },
    { role: 'user', content: 'Какие главные выводы?' },
  ];
  const context = buildConversationMessages(messages, 'Ключевые факты и выводы документа.');
  assert.equal(context[0].role, 'system');
  assert.match(context[0].content, /Ключевые факты/);
  assert.equal(context.some((message) => message.content.includes('ЧАСТНЫЙ ТЕКСТ')), false);
  assert.equal(context.at(-1).content, 'Какие главные выводы?');
});

test('keeps a short document as a single chunk', () => {
  assert.deepEqual(splitLongText('Короткий текст', { maxChars: 100, overlap: 10 }), [
    { text: 'Короткий текст', start: 0, end: 14 },
  ]);
});

