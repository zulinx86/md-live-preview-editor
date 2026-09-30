import { diffLines } from 'diff';

export type GitLineChange = {
	fromLine: number;
	toLine: number;
	kind: 'added' | 'modified' | 'deleted';
	side?: 'before' | 'after';
};

export type GitDiffHunk = {
	change: GitLineChange;
	beforeFromLine: number;
	afterFromLine: number;
	beforeText: string;
	afterText: string;
};

/**
 * Compare HEAD text (`base`) with live Markdown (`current`).
 * Returns inclusive, one-based current-line ranges; deletions are point markers.
 * CRLF/LF differences are ignored. A newline-only EOF change modifies the
 * last content line; alongside content edits, only the content hunks are marked.
 * Aborted diffs return [].
 * An empty document has a deletion anchor before line 1.
 */
export function computeGitLineChanges(base: string, current: string): GitLineChange[] {
	return computeGitDiffHunks(base, current).map((hunk) => hunk.change);
}

/**
 * Compare HEAD text (`base`) with live text (`current`) and return marker hunks.
 * Text contains exactly the changed source lines, with CRLF normalized to LF
 * and actual final terminators preserved. Range starts are one-based logical
 * positions, including positions past the last content line for empty ranges.
 * As with markers, EOF newline differences alongside content edits do not
 * produce separate hunks; these details are not a standalone text patch.
 * Aborted diffs return [] without partial hunks.
 */
export function computeGitDiffHunks(base: string, current: string): GitDiffHunk[] {
	const normalizedBase = base.replace(/\r\n/g, '\n');
	const normalizedCurrent = current.replace(/\r\n/g, '\n');
	// Terminate each nonempty input uniformly without dropping real blank lines.
	const baseContent = terminateLastLine(normalizedBase);
	const currentContent = terminateLastLine(normalizedCurrent);
	if (baseContent === currentContent) {
		if (normalizedBase === normalizedCurrent) return [];
		const line = currentContent.split('\n').length - 1;
		const offset = currentContent.lastIndexOf('\n', currentContent.length - 2) + 1;
		return [{
			change: { fromLine: line, toLine: line, kind: 'modified' },
			beforeFromLine: line,
			afterFromLine: line,
			beforeText: normalizedBase.slice(offset),
			afterText: normalizedCurrent.slice(offset),
		}];
	}

	const parts = diffLines(baseContent, currentContent, {
		timeout: 50,
		maxEditLength: 2_000,
	});
	if (!parts) return [];

	const hunks: GitDiffHunk[] = [];
	let baseLine = 1;
	let baseOffset = 0;
	let currentOffset = 0;
	let currentLine = 1;
	for (let i = 0; i < parts.length;) {
		const part = parts[i];
		if (!part.added && !part.removed) {
			baseLine += part.count;
			currentLine += part.count;
			baseOffset += part.value.length;
			currentOffset += part.value.length;
			i++;
			continue;
		}

		// All adjacent removals and additions form a single changed hunk.
		const beforeOffset = baseOffset;
		const afterOffset = currentOffset;
		let added = 0;
		let removed = 0;
		while (i < parts.length && (parts[i].added || parts[i].removed)) {
			if (parts[i].added) {
				added += parts[i].count;
				currentOffset += parts[i].value.length;
			} else {
				removed += parts[i].count;
				baseOffset += parts[i].value.length;
			}
			i++;
		}
		let change: GitLineChange;
		if (added > 0) {
			change = {
				fromLine: currentLine,
				toLine: currentLine + added - 1,
				kind: removed > 0 ? 'modified' : 'added',
			};
		} else {
			// Terminal newlines do not create a phantom content row at EOF.
			const after = i === parts.length && currentLine > 1;
			const line = after ? currentLine - 1 : currentLine;
			change = {
				fromLine: line,
				toLine: line,
				kind: 'deleted',
				side: after ? 'after' : 'before',
			};
		}
		// Slice the original normalized strings so synthetic EOF newlines never leak.
		hunks.push({
			change,
			beforeFromLine: baseLine,
			afterFromLine: currentLine,
			beforeText: normalizedBase.slice(beforeOffset, baseOffset),
			afterText: normalizedCurrent.slice(afterOffset, currentOffset),
		});
		baseLine += removed;
		currentLine += added;
	}
	return hunks;
}

function terminateLastLine(text: string): string {
	return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}
