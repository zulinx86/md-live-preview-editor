import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { SearchMatchCounter } from './searchMatchCount';

function stateFor(doc: string, query: SearchQuery) {
	return EditorState.create({ doc, extensions: search() }).update({ effects: setSearchQuery.of(query) }).state;
}

describe('search match counts', () => {
	it('counts source text and recognizes forward and reversed selections', () => {
		const counter = new SearchMatchCounter();
		const state = stateFor('cat CAT catalog', new SearchQuery({ search: 'cat' }));
		expect(counter.count(state)).toEqual({ current: 0, total: 3 });
		expect(counter.count(state.update({ selection: { anchor: 4, head: 7 } }).state)).toEqual({ current: 2, total: 3 });
		expect(counter.count(state.update({ selection: { anchor: 11, head: 8 } }).state)).toEqual({ current: 3, total: 3 });
	});
	it('does not rescan the document when only the selection changes', () => {
		const query = new SearchQuery({ search: 'a' });
		const spy = vi.spyOn(query, 'getCursor');
		const state = stateFor('a a a', query);
		const counter = new SearchMatchCounter();
		counter.count(state);
		counter.count(state.update({ selection: { anchor: 2, head: 3 } }).state);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(counter.count(state.update({ changes: { from: 0, to: 1 } }).state).total).toBe(2);
		expect(spy).toHaveBeenCalledTimes(2);
	});
	it('applies case, whole-word, and regex rules', () => {
		const counter = new SearchMatchCounter();
		for (const [query, total] of [
			[new SearchQuery({ search: 'cat', caseSensitive: true }), 2],
			[new SearchQuery({ search: 'cat', wholeWord: true }), 2],
			[new SearchQuery({ search: 'c.t', regexp: true }), 3],
			[new SearchQuery({ search: '[', regexp: true }), 0],
			[new SearchQuery({ search: '' }), 0],
		] as const) expect(counter.count(stateFor('cat CAT catalog', query)).total).toBe(total);
	});
	it('handles zero-length regex matches without looping', () => {
		const state = stateFor('a a', new SearchQuery({ search: '(?=a)', regexp: true }));
		expect(new SearchMatchCounter().count(state)).toEqual({ current: 1, total: 2 });
	});
});

for (const regexp of [false, true]) {
	it(`counts overlapping matches (regexp: ${regexp})`, () => {
		const state = stateFor('ababa', new SearchQuery({ search: 'aba', regexp }));
		const counter = new SearchMatchCounter();
		expect(counter.count(state)).toEqual({ current: 0, total: 2 });
		expect(counter.count(state.update({ selection: { anchor: 2, head: 5 } }).state)).toEqual({ current: 2, total: 2 });
	});
}
it('does not rescan for replacement-only changes', () => {
	const query = new SearchQuery({ search: 'cat' });
	const state = stateFor('cat cat', query);
	const counter = new SearchMatchCounter();
	counter.count(state);
	const replacement = new SearchQuery({ search: 'cat', replace: 'dog' });
	const spy = vi.spyOn(replacement, 'getCursor');
	expect(counter.count(state.update({ effects: setSearchQuery.of(replacement) }).state).total).toBe(2);
	expect(spy).not.toHaveBeenCalled();
});
