import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test } from 'vitest';
import { guideRegistry } from '../src/devtools/shared/guides/registry.js';
import { GuideText } from '../src/ui/GuideText.js';

const render = (text: string) => renderToStaticMarkup(createElement(GuideText, { children: text }));

test('guide emphasis preserves punctuation, spaces, shortcuts and repeated keywords', () => {
  assert.equal(
    render('Choose **+ Add Bone**, then **Undo** / **Undo**.'),
    'Choose <strong class="guide-keyword">+ Add Bone</strong>, then <strong class="guide-keyword">Undo</strong> / <strong class="guide-keyword">Undo</strong>.',
  );
});

test('guide copy renders HTML and other Markdown literally, including incomplete emphasis', () => {
  assert.equal(
    render('<script>alert(1)</script> **<button>** [link](https://example.com) **unfinished'),
    '&lt;script&gt;alert(1)&lt;/script&gt; <strong class="guide-keyword">&lt;button&gt;</strong> [link](https://example.com) **unfinished',
  );
  assert.equal(render('Plain text stays plain.'), 'Plain text stays plain.');
});

test('all shipped guide steps and practice instructions have balanced keyword emphasis', () => {
  for (const guide of guideRegistry.getAllGuides()) {
    for (const step of guide.steps) {
      const copies = [step.description, ...(step.mode === 'try-it' ? [step.practice.instruction] : [])];
      for (const copy of copies) {
        const rendered = render(copy);
        assert.include(rendered, '<strong class="guide-keyword">', `${guide.id}/${step.id}`);
        assert.notInclude(rendered, '**', `${guide.id}/${step.id}`);
      }
    }
  }
});
