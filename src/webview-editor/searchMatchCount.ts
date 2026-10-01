import type { EditorState, Text } from '@codemirror/state';
import { getSearchQuery, SearchCursor, type SearchQuery } from '@codemirror/search';

/** Count source matches once per document/query and locate the primary selection. */
export class SearchMatchCounter {
	private doc: Text | undefined;
	private query: SearchQuery | undefined;
	private matches: Array<{ from: number; to: number }> = [];

	/** Return the one-based selected match (zero when none) and total for state. */
	count(state: EditorState): { current: number; total: number } {
		const query = getSearchQuery(state);
		if (this.doc !== state.doc || !this.query
			|| this.query.search !== query.search || this.query.caseSensitive !== query.caseSensitive
			|| this.query.literal !== query.literal || this.query.regexp !== query.regexp
			|| this.query.wholeWord !== query.wholeWord || this.query.test !== query.test) {
			this.doc = state.doc;
			this.query = query;
			this.matches = [];
			if (query.valid && query.search) {
				let cursor = query.getCursor(state);
				for (;;) {
					const match = cursor instanceof SearchCursor ? cursor.nextOverlapping() : cursor.next();
					if (match.done) break;
					const { from, to } = match.value;
					this.matches.push({ from, to });
					// Regex navigation can start inside an earlier match. Restart after
					// its first character to include those overlapping matches as well.
					if (query.regexp && to > from + 1) cursor = query.getCursor(state, from + 1);
				}
			}
		}
		const selected = state.selection.main;
		let low = 0, high = this.matches.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.matches[middle].from < selected.from) low = middle + 1;
			else high = middle;
		}
		const match = this.matches[low];
		return {
			current: match?.from === selected.from && match.to === selected.to ? low + 1 : 0,
			total: this.matches.length,
		};
	}
}
