import { describe, expect, it, vi } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { language } from '@codemirror/language';
import { parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { GFM } from './gfmTableFix';
import { getLinkReferences, resolveMarkdownLink, type LinkReferences } from './markdownLinks';

function stateFor(doc: string): EditorState {
	return EditorState.create({ doc, extensions: markdown({ extensions: GFM }) });
}

function resolve(source: string, references: LinkReferences = new Map()) {
	let link: SyntaxNode | null = null;
	parser.parse(source).iterate({
		enter(node) {
			if (!link && node.name === 'Link') link = node.node;
		},
	});
	if (!link) throw new Error(`No Link node in ${source}`);
	return resolveMarkdownLink(link, (from, to) => source.slice(from, to), references);
}

describe('resolveMarkdownLink', () => {
	it.each(['[design]', '[**design**]', '[design][unknown]', '[design][]'])(
		'leaves undefined brackets unresolved: %s', (source) => {
			expect(resolve(source)).toBeNull();
		},
	);

	it('returns original label offsets, preserving nested markup for callers', () => {
		const source = 'prefix [**design**](/doc "title")';
		const result = resolve(source);
		expect(result).toEqual({ labelFrom: 8, labelTo: 18, href: '/doc', title: 'title' });
		expect(source.slice(result!.labelFrom, result!.labelTo)).toBe('**design**');
	});

	it.each(['[x]()', '[x](   )', '[x](<>)', '[x](<> "")'])(
		'resolves empty inline destinations: %s', (source) => {
			expect(resolve(source)).toMatchObject({ labelFrom: 1, labelTo: 2, href: '' });
		},
	);

	it('returns empty label ranges for the renderer to handle', () => {
		expect(resolve('[]()')).toEqual({ labelFrom: 1, labelTo: 1, href: '' });
	});

	it.each(['[shown][design]', '[design][]', '[design]'])(
		'resolves full, collapsed and shortcut references: %s', (source) => {
			const references = getLinkReferences(stateFor('[design]: /doc "A title"'));
			expect(resolve(source, references)).toMatchObject({ href: '/doc', title: 'A title' });
		},
	);

	it('prefers an inline destination and does not fall back from an explicit missing label', () => {
		const references = getLinkReferences(stateFor('[x]: /fallback'));
		expect(resolve('[x]()', references)?.href).toBe('');
		expect(resolve('[x][missing]', references)).toBeNull();
		expect(resolve('[x][ ]', references)).toBeNull();
	});

	it('normalizes case and label whitespace, including multiline references', () => {
		const references = getLinkReferences(stateFor('[  Mixed\t label  ]: /doc\n\n[Straße]: /unicode'));
		expect(resolve('[shown][mixed\n LABEL]', references)?.href).toBe('/doc');
		expect(resolve('[STRASSE]', references)?.href).toBe('/unicode');
	});

	it('matches raw label escapes and entities without decoding them', () => {
		const references = getLinkReferences(stateFor(String.raw`[a\*b]: /escaped
[a&amp;b]: /entity`));
		expect(resolve(String.raw`[a\*b]`, references)?.href).toBe('/escaped');
		expect(resolve('[a*b]', references)).toBeNull();
		expect(resolve('[a&amp;b][]', references)?.href).toBe('/entity');
		expect(resolve('[a&b]', references)).toBeNull();
	});

	it.each([
		String.raw`[x](<a\*b?x=1&amp;y=&#x32;> "a\"b &copy;")`,
		String.raw`[x][ref]`,
	])('decodes destination/title escapes and entities: %s', (source) => {
		const references = getLinkReferences(stateFor(String.raw`[ref]: <a\*b?x=1&amp;y=&#x32;> "a\"b &copy;"`));
		expect(resolve(source, references)).toMatchObject({ href: 'a*b?x=1&y=2', title: 'a"b ©' });
	});

	it('decodes tokens only once and requires entity semicolons', () => {
		const source = String.raw`[x](<\&amp;&amp;copy;&#92;*%20&copy> 'it\'s &amp;')`;
		expect(resolve(source)).toMatchObject({ href: '&amp;&copy;\\*%20&copy', title: "it's &" });
	});

	it('resolves empty reference destinations with titles', () => {
		const references = getLinkReferences(stateFor('[x]: <> (title)'));
		expect(resolve('[x]', references)).toMatchObject({ href: '', title: 'title' });
	});
});

describe('getLinkReferences', () => {
	it('uses the first definition, including an empty destination', () => {
		const references = getLinkReferences(stateFor('[x]: <>\n[X]: /later'));
		expect(resolve('[x]', references)?.href).toBe('');
	});

	it('finds definitions after usage far beyond the initial viewport', () => {
		const state = stateFor('[later]\n\n' + 'paragraph\n\n'.repeat(5000) + '[later]: /end');
		expect(resolve('[later]', getLinkReferences(state))?.href).toBe('/end');
	});

	it('includes definitions in block containers but excludes code and frontmatter', () => {
		const state = stateFor([
			'---', '', '[front]: /hidden', '', '---', '',
			'```md', '[fenced]: /hidden', '```', '',
			'    [indented]: /hidden', '',
			'`[inline]: /hidden`', '',
			'> [quoted]: /quote', '', '- [listed]: /list', '', '[visible]: /shown',
		].join('\n'));
		const references = getLinkReferences(state);
		for (const label of ['front', 'fenced', 'indented', 'inline']) {
			expect(resolve(`[${label}]`, references)).toBeNull();
		}
		expect(resolve('[quoted]', references)?.href).toBe('/quote');
		expect(resolve('[listed]', references)?.href).toBe('/list');
		expect(resolve('[visible]', references)?.href).toBe('/shown');
	});

	it('reuses one complete parse for selection-only states and repeated callers', () => {
		const state = stateFor('[x]: /doc');
		const configuredParser = state.facet(language)!.parser;
		const parse = vi.spyOn(configuredParser, 'parse');
		try {
			const first = getLinkReferences(state);
			const selected = state.update({ selection: { anchor: 2 } }).state;
			expect(selected.doc).toBe(state.doc);
			expect(getLinkReferences(selected)).toBe(first);
			expect(getLinkReferences(state)).toBe(first);
			expect(parse).toHaveBeenCalledTimes(1);
		} finally {
			parse.mockRestore();
		}
	});

	it('invalidates the index when the document changes', () => {
		const state = stateFor('[x]: /old');
		const first = getLinkReferences(state);
		const edited = state.update({ changes: { from: 5, to: state.doc.length, insert: '/new' } }).state;
		expect(getLinkReferences(edited)).not.toBe(first);
		expect(resolve('[x]', getLinkReferences(edited))?.href).toBe('/new');
	});

	it('uses the configured parser and keys the cache by parser as well as document', () => {
		const compartment = new Compartment();
		const state = EditorState.create({ doc: '[x]: /doc', extensions: compartment.of(markdown()) });
		const first = getLinkReferences(state);
		const changed = state.update({ effects: compartment.reconfigure(markdown({ extensions: { remove: ['LinkReference'] } })) }).state;
		expect(changed.doc).toBe(state.doc);
		expect(getLinkReferences(changed)).not.toBe(first);
		expect(getLinkReferences(changed).size).toBe(0);
		expect(resolve('[x]', first)?.href).toBe('/doc');
	});

	it('returns an empty index when no language is configured', () => {
		expect(getLinkReferences(EditorState.create({ doc: '[x]: /doc' })).size).toBe(0);
	});
});
