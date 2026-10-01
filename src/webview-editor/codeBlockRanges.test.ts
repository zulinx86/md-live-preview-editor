import { describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { getCodeBlockRanges } from './codeBlockRanges';

function stateFor(doc: string): EditorState {
	return EditorState.create({ doc, extensions: markdown() });
}

function foldedText(doc: string): string[] {
	const state = stateFor(doc);
	return getCodeBlockRanges(state).map(range => state.doc.sliceString(range.from, range.to));
}

describe('code block ranges', () => {
	it.each(['```', '~~~'])('folds %s fences through the closing fence, excluding following text', fence => {
		const doc = 'before\n\n' + fence + 'js\nfirst\nsecond\n' + fence + '\n\nafter';
		const state = stateFor(doc);
		expect(getCodeBlockRanges(state)).toEqual([{
			blockFrom: 8, openingFrom: 8, firstContentFrom: state.doc.line(4).from,
			from: state.doc.line(3).to, to: state.doc.line(6).to, fenced: true,
		}]);
	});

	it.each(['', 'plain', '```', '```js', '~~~', '    only', '    only\n', '`inline`'])(
		'has no fold for empty documents or single-line blocks: %j', doc => {
			expect(getCodeBlockRanges(stateFor(doc))).toEqual([]);
		});

	it.each(['```\n```', '```\nbody\n```', '```\nbody', '```\n', '```\n\n', '~~~js\nbody'])(
		'includes empty, single-body-line, and unclosed multiline fences: %j', doc => {
			const state = stateFor(doc);
			expect(getCodeBlockRanges(state)).toEqual([{
				blockFrom: 0, openingFrom: 0, firstContentFrom: state.doc.line(2).from,
				from: state.doc.line(1).to, to: state.doc.length, fenced: true,
			}]);
		});

	it.each(['> ', '- ', '1. ', '  ', '> - '])('preserves the first source line inside prefix %j', prefix => {
		const continuation = prefix.replace(/[-1.]/g, ' ');
		const doc = prefix + '```js\n' + continuation + 'body\n' + continuation + '```';
		const state = stateFor(doc);
		expect(getCodeBlockRanges(state)).toEqual([{
			blockFrom: prefix.length, openingFrom: 0, firstContentFrom: state.doc.line(2).from,
			from: state.doc.line(1).to, to: state.doc.length, fenced: true,
		}]);
	});

	it.each([
		['    first\n    second\n\nafter', 1, 4, 2],
		['>     first\n>     second\n\nafter', 1, 6, 2],
		['- item\n\n      first\n      second\n\nafter', 3, 6, 4],
		['    first\n\n    second', 1, 4, 3],
	] as const)('keeps the first indented code line visible: %j', (doc, firstNumber, indent, lastNumber) => {
		const state = stateFor(doc);
		const first = state.doc.line(firstNumber);
		expect(getCodeBlockRanges(state)).toEqual([{
			blockFrom: first.from + indent, openingFrom: first.from,
			firstContentFrom: state.doc.line(firstNumber + 1).from,
			from: first.to, to: state.doc.line(lastNumber).to, fenced: false,
		}]);
	});

	it.each(['mermaid', 'drawio', 'diagrams.net', 'diagramsnet', 'mxgraph', ' MERMAID ', 'DrawIO'])(
		'excludes diagram language %j', lang => {
			expect(foldedText('```' + lang + '\nbody\n```')).toEqual([]);
		});

	it.each(['xml', 'javascript', '', 'mermaid extra'])('includes ordinary language %j using the UI info-string contract', lang => {
		expect(foldedText('```' + lang + '\nbody\n```')).toEqual(['\nbody\n```']);
	});

	it('excludes both code kinds inside frontmatter while retaining subsequent code', () => {
		const doc = '---\n```js\nfake\n```\n\n    fake\n    continuation\n---\n\n```js\nreal\n```';
		expect(getCodeBlockRanges(stateFor(doc)).map(r => r.blockFrom)).toEqual([doc.lastIndexOf('```js')]);
	});

	it('does not treat an unclosed frontmatter delimiter as frontmatter', () => {
		expect(foldedText('---\n\n```js\nbody\n```')).toEqual(['\nbody\n```']);
	});

	it('does not invent blocks from fence-like literal text', () => {
		expect(foldedText('````md\n```js\nfake\n```\n````')).toEqual(['\n```js\nfake\n```\n````']);
		expect(foldedText('    ```js\n    fake\n    ```')).toEqual(['\n    fake\n    ```']);
		expect(foldedText('<div>\n```js\nfake\n```\n</div>')).toEqual([]);
		expect(foldedText('<!--\n```js\nfake\n```\n-->')).toEqual([]);
	});

	it.each(['md', 'mermaid'])('prunes embedded Markdown ASTs even for excluded %s fences', lang => {
		const doc = '````' + lang + '\n```js\nfake\n```\n````';
		const state = EditorState.create({ doc, extensions: markdown({ codeLanguages: () => markdownLanguage }) });
		const nodes: string[] = [];
		for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(doc.indexOf('fake'), 1); node; node = node.parent) {
			nodes.push(node.name);
		}
		// Resolve into the overlay to confirm the fixture mounts a nested code block.
		expect(nodes.filter(name => name === 'FencedCode')).toHaveLength(2);
		const ranges = getCodeBlockRanges(state);
		expect(ranges).toHaveLength(lang === 'md' ? 1 : 0);
		if (lang === 'md') expect(ranges[0].to).toBe(state.doc.length);
	});

	it.each(['', '\n', '\r\n'])('uses document offsets for CRLF, Unicode, and EOF with ending %j', ending => {
		const state = stateFor('> ```js\r\n> 日本語 😀\r\n> ```' + ending);
		expect(getCodeBlockRanges(state)).toEqual([{
			blockFrom: 2, openingFrom: 0, firstContentFrom: state.doc.line(2).from,
			from: state.doc.line(1).to, to: state.doc.line(3).to, fenced: true,
		}]);
	});

	it('reuses a complete syntax tree without parsing', () => {
		const state = stateFor('```js\nbody\n```');
		expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
		const spy = vi.spyOn(state.facet(language)!.parser, 'parse');
		try {
			expect(getCodeBlockRanges(state)).toHaveLength(1);
			expect(spy).not.toHaveBeenCalled();
		} finally { spy.mockRestore(); }
	});

	it('fully parses beyond the initial viewport once and caches across selection changes', () => {
		const doc = '```js\nstart\n```\n\n' + 'paragraph\n\n'.repeat(5000) + '```js\nend';
		const state = stateFor(doc);
		expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
		const spy = vi.spyOn(state.facet(language)!.parser, 'parse');
		try {
			const ranges = getCodeBlockRanges(state);
			expect(ranges).toHaveLength(2);
			expect(ranges[1].blockFrom).toBe(doc.lastIndexOf('```js'));
			expect(ranges[1].to).toBe(state.doc.length);
			expect(getCodeBlockRanges(state)).toBe(ranges);
			const moved = state.update({ selection: { anchor: 3 } }).state;
			expect(getCodeBlockRanges(moved)).toBe(ranges);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally { spy.mockRestore(); }
	});

	it('invalidates on edits and parser reconfiguration and handles absent parsers', () => {
		const state = stateFor('```js\nbody\n```');
		const ranges = getCodeBlockRanges(state);
		const edited = state.update({ changes: { from: 5, to: state.doc.length } }).state;
		expect(getCodeBlockRanges(edited)).toEqual([]);
		const reconfigured = state.update({ effects: StateEffect.reconfigure.of(markdown({ extensions: { remove: ['FencedCode'] } })) }).state;
		expect(reconfigured.doc).toBe(state.doc);
		expect(getCodeBlockRanges(reconfigured)).toEqual([]);
		expect(getCodeBlockRanges(state)).toBe(ranges);
		expect(getCodeBlockRanges(EditorState.create({ doc: '```js\nbody\n```' }))).toEqual([]);
	});
});
