import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeGitDiffHunks, computeGitLineChanges, type GitDiffHunk, type GitLineChange } from './gitLineChanges';

const added = (fromLine: number, toLine = fromLine): GitLineChange =>
	({ fromLine, toLine, kind: 'added' });
const modified = (fromLine: number, toLine = fromLine): GitLineChange =>
	({ fromLine, toLine, kind: 'modified' });
const deleted = (line: number, side: 'before' | 'after'): GitLineChange =>
	({ fromLine: line, toLine: line, kind: 'deleted', side });

describe('computeGitLineChanges', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each<[string, string, string, GitLineChange[]]>([
		['unchanged', 'a\nb', 'a\nb', []],
		['insert at start', 'a\nb', 'x\ny\na\nb', [added(1, 2)]],
		['insert in middle', 'a\nb', 'a\nx\ny\nb', [added(2, 3)]],
		['insert at end', 'a\nb', 'a\nb\nx\ny', [added(3, 4)]],
		['replace at start', 'a\nb\nc', 'x\nb\nc', [modified(1)]],
		['replace in middle', 'a\nb\nc', 'a\nx\nc', [modified(2)]],
		['replace at end', 'a\nb\nc', 'a\nb\nx', [modified(3)]],
		['expand replacement', 'a\nb\nc', 'a\nx\ny\nc', [modified(2, 3)]],
		['shrink replacement', 'a\nx\ny\nc', 'a\nb\nc', [modified(2)]],
		['delete at start', 'x\ny\na\nb', 'a\nb', [deleted(1, 'before')]],
		['delete in middle', 'a\nx\ny\nb', 'a\nb', [deleted(2, 'before')]],
		['delete at end', 'a\nb\nx\ny', 'a\nb', [deleted(2, 'after')]],
		['delete at terminated EOF', 'a\nb\nx\n', 'a\nb\n', [deleted(2, 'after')]],
		['browser EOF deletion', 'keep\nremoved', 'keep', [deleted(1, 'after')]],
		['browser delete all', 'keep\nremoved', '', [deleted(1, 'before')]],
		['browser EOF deletion with CRLF', 'keep\r\nremoved', 'keep', [deleted(1, 'after')]],
		['EOF replacement and removal', 'keep\nold\nremoved', 'keep\nnew', [modified(2)]],
		['EOF replacement with newline removal', 'keep\nold\n', 'keep\nnew', [modified(2)]],
		['blank line retained after deletion', 'keep\n\nremoved', 'keep\n\n', [deleted(2, 'after')]],
		['blank line deleted at unterminated EOF', 'keep\n\n', 'keep', [deleted(1, 'after')]],
		['blank-only new file', '', '\n\n', [added(1, 2)]],
		['blank-only file deleted', '\n\n', '', [deleted(1, 'before')]],
		['empty inputs', '', '', []],
		['new file', '', '# Title\nbody\n', [added(1, 2)]],
		['new unterminated file', '', 'a', [added(1)]],
		['empty current', 'a\nb\n', '', [deleted(1, 'before')]],
		['new blank line', '', '\n', [added(1)]],
		['remove only blank line', '\n', '', [deleted(1, 'before')]],
		['add terminal newline', 'a', 'a\n', [modified(1)]],
		['remove terminal newline', 'a\n', 'a', [modified(1)]],
		['add terminal newline on last line', 'a\nb', 'a\nb\n', [modified(2)]],
		['remove terminal newline on last line', 'a\nb\n', 'a\nb', [modified(2)]],
		['add CRLF terminator', 'a\nb', 'a\r\nb\r\n', [modified(2)]],
		['remove CRLF terminator', 'a\r\nb\r\n', 'a\nb', [modified(2)]],
		['replace and terminate EOF', 'a\nb', 'a\nx\n', [modified(2)]],
		['append and terminate EOF', 'a', 'a\nb\n', [added(2)]],
		['delete terminated tail', 'a\nb\n', 'a\n', [deleted(1, 'after')]],
		['delete tail and remove terminator', 'a\nb\n', 'a', [deleted(1, 'after')]],
		['delete unterminated tail retaining terminator', 'a\nb', 'a\n', [deleted(1, 'after')]],
		['insert earlier and terminate EOF', 'a\nb', 'x\na\nb\n', [added(1)]],
		['delete earlier and terminate EOF', 'x\na\nb', 'a\nb\n', [deleted(1, 'before')]],
		['add actual trailing blank line', 'a\n', 'a\n\n', [added(2)]],
		['remove actual trailing blank line', 'a\n\n', 'a\n', [deleted(1, 'after')]],
		['preserve whitespace edits', 'a\n  b', 'a\n b', [modified(2)]],
		['CRLF versus LF', 'a\r\nb\r\n', 'a\nb\n', []],
		['LF versus CRLF', 'a\nb\n', 'a\r\nb\r\n', []],
		['mixed line endings', 'a\r\nb\nc', 'a\nx\r\nc\r\n', [modified(2)]],
		['mixed edits in current coordinates', 'a\nb\nc\nd\ne\nf\ng',
			'x\na\nb\nC\nd\nf\ng\ny',
			[added(1), modified(4), deleted(6, 'before'), added(8)]],
	])('%s', (_name, base, current, expected) => {
		expect(computeGitLineChanges(base, current)).toEqual(expected);
	});

	it('keeps marker ranges valid across small documents, blank lines, and repeated lines', () => {
		const documents = new Set(['']);
		let rows: string[][] = [[]];
		for (let length = 1; length <= 3; length++) {
			rows = rows.flatMap((prefix) => ['', 'a', 'b'].map((line) => [...prefix, line]));
			for (const lines of rows) {
				documents.add(lines.join('\n'));
				documents.add(`${lines.join('\n')}\n`);
			}
		}
		for (const base of documents) {
			for (const current of documents) {
				const changes = computeGitLineChanges(base, current);
				const lastLine = Math.max(1, current.split('\n').length - Number(current.endsWith('\n')));
				let previousLine = 1;
				for (const change of changes) {
					expect(change.fromLine).toBeGreaterThanOrEqual(previousLine);
					expect(change.toLine).toBeGreaterThanOrEqual(change.fromLine);
					expect(change.toLine).toBeLessThanOrEqual(lastLine);
					if (change.kind === 'deleted') {
						expect(change.toLine).toBe(change.fromLine);
						expect(['before', 'after']).toContain(change.side);
					} else {
						expect(change.side).toBeUndefined();
					}
					previousLine = change.toLine;
				}
				expect(computeGitLineChanges(base.replace(/\n/g, '\r\n'), current)).toEqual(changes);
				expect(computeGitLineChanges(base, current.replace(/\n/g, '\r\n'))).toEqual(changes);
			}
		}
	});

	it('compares HEAD directly with live text, independently of staged content', () => {
		const head = 'title\noriginal';
		const staged = 'title\nstaged';
		const live = 'title\noriginal\nlive addition';
		expect(computeGitLineChanges(head, staged)).toEqual([modified(2)]);
		expect(computeGitLineChanges(head, live)).toEqual([added(3)]);
		expect(computeGitLineChanges(head, head)).toEqual([]);
	});

	it('returns no markers when the edit limit is exceeded', () => {
		// Freeze time so this exercises the edit limit rather than the timeout.
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const current = Array.from({ length: 2_001 }, (_, i) => `line ${i}`).join('\n');
		expect(computeGitLineChanges('', current)).toEqual([]);
	});

	it('returns no partial markers when the timeout expires', () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000);
		expect(computeGitLineChanges('same\nold', 'same\nnew')).toEqual([]);
	});
});


describe('computeGitDiffHunks', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each<[string, string, string, GitDiffHunk]>([
		['insert at start', 'a\nb', 'x\ny\na\nb', {
			change: added(1, 2), beforeFromLine: 1, afterFromLine: 1,
			beforeText: '', afterText: 'x\ny\n',
		}],
		['insert at unterminated EOF', 'a', 'a\nb', {
			change: added(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: '', afterText: 'b',
		}],
		['expand replacement', 'a\nb\nc', 'a\nx\ny\nc', {
			change: modified(2, 3), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'b\n', afterText: 'x\ny\n',
		}],
		['shrink EOF replacement', 'a\nx\ny\n', 'a\nb', {
			change: modified(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'x\ny\n', afterText: 'b',
		}],
		['delete at start', 'x\na\nb', 'a\nb', {
			change: deleted(1, 'before'), beforeFromLine: 1, afterFromLine: 1,
			beforeText: 'x\n', afterText: '',
		}],
		['delete in middle', 'a\nx\nb', 'a\nb', {
			change: deleted(2, 'before'), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'x\n', afterText: '',
		}],
		['delete at unterminated EOF', 'keep\nremoved', 'keep', {
			change: deleted(1, 'after'), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'removed', afterText: '',
		}],
		['delete at terminated EOF', 'keep\nremoved\n', 'keep\n', {
			change: deleted(1, 'after'), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'removed\n', afterText: '',
		}],
		['fully emptied document', 'keep\nremoved', '', {
			change: deleted(1, 'before'), beforeFromLine: 1, afterFromLine: 1,
			beforeText: 'keep\nremoved', afterText: '',
		}],
		['new blank-only document', '', '\n\n', {
			change: added(1, 2), beforeFromLine: 1, afterFromLine: 1,
			beforeText: '', afterText: '\n\n',
		}],
		['delete actual trailing blank', 'a\n\n', 'a\n', {
			change: deleted(1, 'after'), beforeFromLine: 2, afterFromLine: 2,
			beforeText: '\n', afterText: '',
		}],
		['add final newline only', 'a\nb', 'a\nb\n', {
			change: modified(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'b', afterText: 'b\n',
		}],
		['remove final newline only', 'a\nb\n', 'a\nb', {
			change: modified(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'b\n', afterText: 'b',
		}],
		['normalize mixed CRLF', 'a\r\nold\r\n', 'a\nnew', {
			change: modified(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: 'old\n', afterText: 'new',
		}],
		['preserve lone CR and Unicode', 'a\n旧\rvalue', 'a\n新😀\rvalue\n', {
			change: modified(2), beforeFromLine: 2, afterFromLine: 2,
			beforeText: '旧\rvalue', afterText: '新😀\rvalue\n',
		}],
		['suppress separate EOF newline edit', 'a\nb', 'x\na\nb\n', {
			change: added(1), beforeFromLine: 1, afterFromLine: 1,
			beforeText: '', afterText: 'x\n',
		}],
	])('%s', (_name, base, current, expected) => {
		expect(computeGitDiffHunks(base, current)).toEqual([expected]);
	});

	it('tracks independent source coordinates across separated edits', () => {
		expect(computeGitDiffHunks('a\nb\nc\nd\ne\nf\ng', 'x\na\nb\nC\nd\nf\ng\ny')).toEqual([
			{ change: added(1), beforeFromLine: 1, afterFromLine: 1, beforeText: '', afterText: 'x\n' },
			{ change: modified(4), beforeFromLine: 3, afterFromLine: 4, beforeText: 'c\n', afterText: 'C\n' },
			{ change: deleted(6, 'before'), beforeFromLine: 5, afterFromLine: 6, beforeText: 'e\n', afterText: '' },
			{ change: added(8), beforeFromLine: 8, afterFromLine: 8, beforeText: '', afterText: 'y' },
		]);
	});

	it('reconstructs terminated documents in both directions, including repeated and blank lines', () => {
		const documents = [''];
		let rows: string[][] = [[]];
		for (let length = 1; length <= 3; length++) {
			rows = rows.flatMap((prefix) => ['', 'a', 'b'].map((line) => [...prefix, line]));
			documents.push(...rows.map((lines) => `${lines.join('\n')}\n`));
		}
		for (const base of documents) {
			for (const current of documents) {
				const hunks = computeGitDiffHunks(base, current);
				let forward = base;
				let reverse = current;
				for (const hunk of [...hunks].reverse()) {
					const beforeOffset = base.split('\n').slice(0, hunk.beforeFromLine - 1).join('\n').length
						+ Number(hunk.beforeFromLine > 1);
					const afterOffset = current.split('\n').slice(0, hunk.afterFromLine - 1).join('\n').length
						+ Number(hunk.afterFromLine > 1);
					expect(base.slice(beforeOffset, beforeOffset + hunk.beforeText.length)).toBe(hunk.beforeText);
					expect(current.slice(afterOffset, afterOffset + hunk.afterText.length)).toBe(hunk.afterText);
					forward = forward.slice(0, beforeOffset) + hunk.afterText
						+ forward.slice(beforeOffset + hunk.beforeText.length);
					reverse = reverse.slice(0, afterOffset) + hunk.beforeText
						+ reverse.slice(afterOffset + hunk.afterText.length);
				}
				expect(forward).toBe(current);
				expect(reverse).toBe(base);
				expect(computeGitDiffHunks(base.replace(/\n/g, '\r\n'), current)).toEqual(hunks);
				expect(computeGitDiffHunks(base, current.replace(/\n/g, '\r\n'))).toEqual(hunks);
			}
		}
	});

	it('returns no hunks for normalized identical or empty documents', () => {
		expect(computeGitDiffHunks('', '')).toEqual([]);
		expect(computeGitDiffHunks('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
	});

	it('returns no hunks when the edit limit is exceeded', () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const current = Array.from({ length: 2_001 }, (_, i) => `line ${i}`).join('\n');
		expect(computeGitDiffHunks('', current)).toEqual([]);
	});

	it('returns no partial hunks when the timeout expires', () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000);
		expect(computeGitDiffHunks('same\nold', 'same\nnew')).toEqual([]);
	});
});
