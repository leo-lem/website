import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureData, plainBody, readMinutes } from './markdown.ts';

test('a figure alt is a sentence, colons included, quoted or not', () => {
  const forms = '\nforms:\n  - { shape: hexagon, at: [0.5, 0.5], size: 0.2, label: a }';
  assert.equal(figureData(`alt: From idea to inbox: five steps.${forms}`).alt, 'From idea to inbox: five steps.');
  assert.equal(figureData(`alt: "Quoted: still fine."${forms}`).alt, 'Quoted: still fine.');
  assert.equal(figureData(`alt: Plain.${forms}`).forms![0].label, 'a');
  assert.match(plainBody('```figure\nalt: A: b.\nforms: []\n```', 'https://x'), /\*Figure: A: b\.\*/);
});

test('reading time counts the plain words at 220 a minute, rounded up, at least one', () => {
  assert.equal(readMinutes('Short.'), 1);
  assert.equal(readMinutes('word '.repeat(220)), 1);
  assert.equal(readMinutes('word '.repeat(221)), 2);
  assert.equal(readMinutes(`${'word '.repeat(200)}[a link](/x/) ${'word '.repeat(20)}`), 2);
  assert.equal(readMinutes('## Heading\n\n> - | --- |'), 1);
});
