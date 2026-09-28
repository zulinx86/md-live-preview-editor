import type { EditorState, Text } from '@codemirror/state';
import { DocInput, language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { Parser } from '@lezer/common';
import { detectFrontmatter } from './frontmatterWidget';

export interface SectionRange {
	headingFrom: number;
	from: number;
	to: number;
	level: number;
}

const cache = new WeakMap<Text, WeakMap<Parser, readonly SectionRange[]>>();
const empty: readonly SectionRange[] = [];

/** Returns foldable document-level heading sections for the state's document and parser. */
export function getSectionRanges(state: EditorState): readonly SectionRange[] {
	const parser = state.facet(language)?.parser;
	if (!parser) return empty;
	let byParser = cache.get(state.doc);
	const cached = byParser?.get(parser);
	if (cached) return cached;

	const tree = syntaxTreeAvailable(state, state.doc.length)
		? syntaxTree(state)
		: parser.parse(new DocInput(state.doc));
	const frontmatter = detectFrontmatter(state);
	const headings: SectionRange[] = [];
	const stack: SectionRange[] = [];

	// Direct document children exclude headings inside quotes, lists, and other blocks.
	for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
		const match = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/.exec(node.name);
		if (!match || (frontmatter && node.from < frontmatter.to)) continue;
		const level = Number(match[1] ?? match[2]);
		const firstLine = state.doc.lineAt(node.from);
		// Leave the line break before the next section visible when folding.
		const end = firstLine.number > 1 ? state.doc.line(firstLine.number - 1).to : 0;
		while (stack.length && stack[stack.length - 1].level >= level) {
			stack.pop()!.to = end;
		}
		const range: SectionRange = {
			headingFrom: firstLine.from,
			from: state.doc.lineAt(node.to).to,
			to: state.doc.length,
			level,
		};
		headings.push(range);
		stack.push(range);
	}

	// Each source span is inspected at most six times, once per heading level.
	const ranges = headings.filter(({ from, to }) =>
		to > from && state.doc.sliceString(from, to).trim().length > 0);
	if (!byParser) {
		byParser = new WeakMap();
		cache.set(state.doc, byParser);
	}
	byParser.set(parser, ranges);
	return ranges;
}

/** Returns the foldable section whose first heading line starts at lineStart, if any. */
export function sectionAtLine(state: EditorState, lineStart: number): SectionRange | undefined {
	const ranges = getSectionRanges(state);
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (ranges[middle].headingFrom < lineStart) low = middle + 1;
		else high = middle;
	}
	return ranges[low]?.headingFrom === lineStart ? ranges[low] : undefined;
}
