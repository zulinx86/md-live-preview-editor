import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { findFragmentPosition } from './fragmentNavigation';

function stateFor(doc: string): EditorState {
	return EditorState.create({ doc, extensions: markdown({ extensions: GFM }) });
}

describe('findFragmentPosition', () => {
	it.each([
		['# Hello World', '#hello-world'],
		['## 日本語の見出し', '#日本語の見出し'],
		['## 日本語の見出し', '#%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE%E8%A6%8B%E5%87%BA%E3%81%97'],
		['## Hello World', '#HELLO-WORLD'],
		['### Hello, World! ###', '#hello-world'],
		['## **Bold** `code` [link](/elsewhere)', '#bold-code-link'],
		['## Café &amp; Tea', '#café--tea'],
		['## <span>Visible</span> ![image](/img.png)', '#visible-image'],
		['## [Title][ref]\n\n[ref]: /path', '#title'],
		['Setext title\n============', '#setext-title'],
	])('finds %s from %s', (heading, href) => {
		const prefix = 'Intro\n\n';
		expect(findFragmentPosition(stateFor(prefix + heading), href)).toBe(prefix.length);
	});

	it('numbers repeated headings and avoids collisions with explicit numbered titles', () => {
		const doc = '# Same\n\n## Same-1\n\n## Same\n\n## Same';
		const state = stateFor(doc);
		expect(findFragmentPosition(state, '#same-1')).toBe(doc.indexOf('## Same-1'));
		expect(findFragmentPosition(state, '#same-2')).toBe(doc.indexOf('## Same\n'));
		expect(findFragmentPosition(state, '#same-3')).toBe(doc.lastIndexOf('## Same'));
	});

	it('ignores frontmatter and code when assigning heading IDs', () => {
		const doc = '---\n# Same\n---\n\n```md\n# Same\n```\n\n    # Same\n\n## Same';
		const state = stateFor(doc);
		expect(findFragmentPosition(state, '#same')).toBe(doc.lastIndexOf('## Same'));
		expect(findFragmentPosition(state, '#same-1')).toBeNull();
	});

	it('finds headings beyond an incremental parser viewport', () => {
		const doc = 'Paragraph\n\n'.repeat(5000) + '## End';
		expect(findFragmentPosition(stateFor(doc), '#end')).toBe(doc.indexOf('## End'));
	});

	it('uses edited, unsaved heading text', () => {
		const state = stateFor('# Old');
		const updated = state.update({ changes: { from: 2, to: 5, insert: 'New' } }).state;
		expect(findFragmentPosition(updated, '#new')).toBe(0);
		expect(findFragmentPosition(updated, '#old')).toBeNull();
	});

	it('supports the top fragment and ignores missing or malformed targets', () => {
		const state = stateFor('Intro\n\n## Target');
		expect(findFragmentPosition(state, '#')).toBe(0);
		for (const href of ['#missing', '#%broken', 'https://example.com/#target']) {
			expect(findFragmentPosition(state, href)).toBeNull();
		}
	});
});
