import { describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import { language, syntaxTreeAvailable } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { getSectionRanges, sectionAtLine } from './sectionRanges';

function stateFor(doc: string): EditorState {
	return EditorState.create({ doc, extensions: markdown() });
}

describe('section ranges', () => {
	it('includes nested headings and closes siblings and parents at their boundaries', () => {
		const doc = '# Parent\nintro\n## Child\nchild\n### Deep\ndeep\n## Sibling\nsibling\n# Next\nlast';
		const state = stateFor(doc);
		const headings = ['# Parent', '## Child', '### Deep', '## Sibling', '# Next'];
		const ends = ['# Next', '## Sibling', '## Sibling', '# Next'];
		expect(getSectionRanges(state)).toEqual(headings.map((heading, i) => ({
			headingFrom: doc.indexOf(heading),
			from: doc.indexOf(heading) + heading.length,
			to: i < ends.length ? doc.indexOf(ends[i]) - 1 : doc.length,
			level: [1, 2, 3, 2, 1][i],
		})));
	});

	it('omits empty and whitespace-only bodies, including headings at EOF', () => {
		const state = stateFor('# Empty\n# Blank\n \t\n\n# Body\ntext\n# EOF');
		expect(getSectionRanges(state).map(r => state.doc.lineAt(r.headingFrom).text)).toEqual(['# Body']);
		expect(getSectionRanges(stateFor(''))).toEqual([]);
		expect(getSectionRanges(stateFor('# EOF'))).toEqual([]);
		expect(getSectionRanges(stateFor('# Blank\n \t\n'))).toEqual([]);
	});

	it('retains blank lines before a sibling and includes a child as parent content', () => {
		const state = stateFor('# Parent\n## Child\n\n# Next\nbody\n');
		const ranges = getSectionRanges(state);
		expect(ranges).toHaveLength(2);
		expect(state.doc.sliceString(ranges[0].from, ranges[0].to)).toBe('\n## Child\n');
		expect(ranges[1].to).toBe(state.doc.length);
	});

	it('keeps multiline Setext headings and their underlines visible', () => {
		const doc = 'Title\ncontinued\n===\nbody\n\nChild\n---\nchild body\n\nNext\n===\nend';
		const state = stateFor(doc);
		const ranges = getSectionRanges(state);
		expect(ranges.map(r => r.level)).toEqual([1, 2, 1]);
		expect(ranges[0].from).toBe(doc.indexOf('===') + 3);
		expect(ranges[1].from).toBe(doc.indexOf('---') + 3);
		expect(ranges[0].to).toBe(doc.indexOf('Next') - 1);
		expect(sectionAtLine(state, 0)).toBe(ranges[0]);
		expect(sectionAtLine(state, doc.indexOf('continued'))).toBeUndefined();
		expect(sectionAtLine(state, doc.indexOf('==='))).toBeUndefined();
	});

	it.each([
		'```md\n# Hidden\n```',
		'~~~\n# Hidden\n~~~',
		'    # Hidden',
		'> # Hidden\n> body',
		'- # Hidden\n  body',
		'1. Hidden\n   ---\n   body',
		'<div>\n# Hidden\n</div>',
		'<!--\n# Hidden\n-->',
	])('excludes headings within %s without closing the surrounding section', block => {
		const doc = '# Visible\nbody\n\n' + block + '\n\n# Next\nend';
		const ranges = getSectionRanges(stateFor(doc));
		expect(ranges.map(r => r.headingFrom)).toEqual([0, doc.indexOf('# Next')]);
		expect(ranges[0].to).toBe(doc.indexOf('# Next') - 1);
	});

	it('excludes frontmatter headings using the existing frontmatter contract', () => {
		const doc = '---\n# Hidden\nTitle\n===\n---\n\n# Visible\nbody';
		expect(getSectionRanges(stateFor(doc)).map(r => r.headingFrom)).toEqual([doc.indexOf('# Visible')]);
	});

	it('preserves CodeMirror document offsets for Unicode and CRLF input', () => {
		const state = stateFor('  # 日本語 😀\r\n本文 🌍\r\n## 子\r\n終わり');
		const ranges = getSectionRanges(state);
		expect(ranges).toEqual([
			{ headingFrom: 0, from: state.doc.line(1).to, to: state.doc.length, level: 1 },
			{ headingFrom: state.doc.line(3).from, from: state.doc.line(3).to, to: state.doc.length, level: 2 },
		]);
		expect(sectionAtLine(state, 0)).toBe(ranges[0]);
		expect(sectionAtLine(state, state.doc.line(2).from)).toBeUndefined();
		expect(sectionAtLine(state, state.doc.length)).toBeUndefined();
	});

	it('reuses a complete syntax tree without reparsing', () => {
		const state = stateFor('# Heading\nbody');
		expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
		const spy = vi.spyOn(state.facet(language)!.parser, 'parse');
		try {
			expect(getSectionRanges(state)).toHaveLength(1);
			expect(spy).not.toHaveBeenCalled();
		} finally { spy.mockRestore(); }
	});

	it('fully parses beyond the initial viewport and reuses the result on selection moves', () => {
		const doc = '# Start\nbody\n\n' + 'Paragraph\n\n'.repeat(5000) + '# End\nlast';
		const state = stateFor(doc);
		expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
		const spy = vi.spyOn(state.facet(language)!.parser, 'parse');
		try {
			const ranges = getSectionRanges(state);
			expect(ranges).toHaveLength(2);
			expect(ranges[1].headingFrom).toBe(doc.indexOf('# End'));
			const moved = state.update({ selection: { anchor: 3 } }).state;
			expect(getSectionRanges(moved)).toBe(ranges);
			expect(sectionAtLine(moved, 0)).toBe(ranges[0]);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally { spy.mockRestore(); }
	});

	it('invalidates cached ranges for document edits and parser reconfiguration', () => {
		const state = stateFor('# Heading\nbody');
		const ranges = getSectionRanges(state);
		const edited = state.update({ changes: { from: state.doc.length, insert: '\n# New\ntext' } }).state;
		expect(getSectionRanges(edited)).not.toBe(ranges);
		expect(getSectionRanges(edited)).toHaveLength(2);
		const reconfigured = state.update({ effects: StateEffect.reconfigure.of(markdown()) }).state;
		expect(reconfigured.doc).toBe(state.doc);
		expect(reconfigured.facet(language)!.parser).not.toBe(state.facet(language)!.parser);
		expect(getSectionRanges(reconfigured)).not.toBe(ranges);
		expect(getSectionRanges(reconfigured)).toEqual(ranges);
		expect(getSectionRanges(EditorState.create({ doc: '# Plain\nbody' }))).toEqual([]);
	});
});
