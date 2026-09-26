import { describe, expect, it } from 'vitest';
import { findMarkdownTerminalLinks } from './terminalFileLinks';

describe('findMarkdownTerminalLinks', () => {
	it.each([
		'readme.md', './docs/guide.markdown', '../notes/a.md', '/tmp/a.md',
		'~/notes/a.md', 'C:\\notes\\a.md', 'C:/notes/a.md',
		'notes/topic:part.md', 'file:///tmp/topic:part.md',
		'file:///C:/notes/my%20note.md', 'README.MD',
	])('preserves %s and defaults the column to one', (path) => {
		const text = `${path}:12`;
		expect(findMarkdownTerminalLinks(text)).toEqual([
			{ startIndex: 0, length: text.length, path, line: 12, column: 1 },
		]);
	});

	it('returns multiple links with exact UTF-16 spans', () => {
		const text = '📚 参照 (資料/案内.md:12:3), [next.markdown:4].';
		expect(findMarkdownTerminalLinks(text)).toEqual([
			{ startIndex: text.indexOf('資料'), length: '資料/案内.md:12:3'.length,
				path: '資料/案内.md', line: 12, column: 3 },
			{ startIndex: text.indexOf('next'), length: 'next.markdown:4'.length,
				path: 'next.markdown', line: 4, column: 1 },
		]);
	});

	it.each([
		['"my notes/a.md":12:3', 'my notes/a.md'],
		["'my notes/a.md':12:3", 'my notes/a.md'],
		['"my notes/a.md:12:3"', 'my notes/a.md'],
		["'my notes/a.md:12:3'", 'my notes/a.md'],
		['"/tmp/(notes)/a.md":12:3', '/tmp/(notes)/a.md'],
		['"file:///tmp/my notes/a.md":12:3', 'file:///tmp/my notes/a.md'],
	])('includes source quotes for %s', (source, path) => {
		expect(findMarkdownTerminalLinks(`see (${source}), now`)).toEqual([
			{ startIndex: 5, length: source.length, path, line: 12, column: 3 },
		]);
	});

	it.each(['(%s)', '[%s]', '{%s}', '<%s>', '`%s`', '%s,', '%s;', '%s.', '%s!'])(
		'excludes punctuation wrappers in %s', (wrapper) => {
			const source = 'a.md:2';
			const text = wrapper.replace('%s', source);
			expect(findMarkdownTerminalLinks(text)).toEqual([
				{ startIndex: text.indexOf(source), length: source.length, path: 'a.md', line: 2, column: 1 },
			]);
		},
	);

	it.each([
		':0', ':-1', ':9007199254740992', ':12:0', ':12:-1', ':12:9007199254740992',
		':12:', ':12:3:4', ':12:abc', ':12abc', ':12:3abc', ':12.5', ':12:3.5',
		':+12', ':12:+3', ':1e2', ':12/path', ':12#fragment', ':12?query',
	])('rejects the entire invalid suffix %s', (suffix) => {
		expect(findMarkdownTerminalLinks(`a.md${suffix} "my notes.md"${suffix} "my notes.md${suffix}"`)).toEqual([]);
	});

	it('accepts safe positive integer boundaries and leading zeros', () => {
		expect(findMarkdownTerminalLinks('a.md:9007199254740991:0002')[0]).toMatchObject({
			line: Number.MAX_SAFE_INTEGER, column: 2,
		});
	});

	it.each([
		'', 'plain text', 'a.ts:12', 'a.mdx:12', 'a.md',
		'https://example.com/a.md:12', 'HTTP://example.com/a.markdown:12:3',
		'"https://example.com/my notes.md":12', '"a.md"extra.md:12',
	])('ignores %s', (text) => {
		expect(findMarkdownTerminalLinks(text)).toEqual([]);
	});

	it('finds later valid links and does not retain regex state', () => {
		const text = 'a.md:12:0 b.md:4';
		const expected = [{ startIndex: 10, length: 6, path: 'b.md', line: 4, column: 1 }];
		expect(findMarkdownTerminalLinks(text)).toEqual(expected);
		expect(findMarkdownTerminalLinks(text)).toEqual(expected);
	});
});
