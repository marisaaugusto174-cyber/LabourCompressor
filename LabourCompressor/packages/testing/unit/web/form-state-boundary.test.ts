import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'apps/web/public/form-state.js'),
  'utf8'
);

test('form state collects controls associated with the form, including advanced controls outside the form element', () => {
  assert.match(source, /form\.elements/u);
  assert.doesNotMatch(source, /form\.querySelectorAll\('\[name\]'\)/u);
  assert.doesNotMatch(source, /form\.querySelector\(`\[name="\$\{CSS\.escape\(name\)\}"\]`\)/u);
});

test('form state can resolve dialog fields outside the task form for picker buttons', () => {
  assert.match(source, /document\.getElementById\(name\)/u);
  assert.match(source, /document\.getElementsByName\(name\)/u);
});
