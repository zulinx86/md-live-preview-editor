import { diffLines } from 'diff';

export type GitLineChange = {
	fromLine: number;
	toLine: number;
	kind: 'added' | 'modified' | 'deleted';
	side?: 'before' | 'after';
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
	const normalizedBase = base.replace(/\r\n/g, '\n');
	const normalizedCurrent = current.replace(/\r\n/g, '\n');
	// Terminate each nonempty input uniformly without dropping real blank lines.
	const baseContent = terminateLastLine(normalizedBase);
	const currentContent = terminateLastLine(normalizedCurrent);
	if (baseContent === currentContent) {
		if (normalizedBase === normalizedCurrent) return [];
		const line = currentContent.split('\n').length - 1;
		return [{ fromLine: line, toLine: line, kind: 'modified' }];
	}

	const parts = diffLines(baseContent, currentContent, {
		timeout: 50,
		maxEditLength: 2_000,
	});
	if (!parts) return [];

	const changes: GitLineChange[] = [];
	let currentLine = 1;
	for (let i = 0; i < parts.length;) {
		const part = parts[i];
		if (!part.added && !part.removed) {
			currentLine += part.count;
			i++;
			continue;
		}

		// All adjacent removals and additions form a single changed hunk.
		let added = 0;
		let removed = 0;
		while (i < parts.length && (parts[i].added || parts[i].removed)) {
			if (parts[i].added) added += parts[i].count;
			else removed += parts[i].count;
			i++;
		}
		if (added > 0) {
			changes.push({
				fromLine: currentLine,
				toLine: currentLine + added - 1,
				kind: removed > 0 ? 'modified' : 'added',
			});
			currentLine += added;
		} else {
			// Terminal newlines do not create a phantom content row at EOF.
			const after = i === parts.length && currentLine > 1;
			const line = after ? currentLine - 1 : currentLine;
			changes.push({
				fromLine: line,
				toLine: line,
				kind: 'deleted',
				side: after ? 'after' : 'before',
			});
		}
	}
	return changes;
}

function terminateLastLine(text: string): string {
	return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}
