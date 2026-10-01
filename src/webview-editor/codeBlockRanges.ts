import type { EditorState, Text } from '@codemirror/state';
import { DocInput, language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { Parser } from '@lezer/common';
import { isDiagramLang } from './diagramLang';
import { detectFrontmatter } from './frontmatterWidget';

export interface CodeBlockRange {
	/** Syntax node start, after any indentation or container prefix. */
	blockFrom: number;
	/** First source line start, including container prefixes. */
	openingFrom: number;
	/** Next source line start; an empty fence may point at its closing fence. */
	firstContentFrom: number;
	from: number;
	to: number;
	fenced: boolean;
}

const cache = new WeakMap<Text, WeakMap<Parser, readonly CodeBlockRange[]>>();
const empty: readonly CodeBlockRange[] = [];

/** Returns multiline code-block folds for state, keeping the first source line visible. */
export function getCodeBlockRanges(state: EditorState): readonly CodeBlockRange[] {
	const parser = state.facet(language)?.parser;
	if (!parser) return empty;
	let byParser = cache.get(state.doc);
	const cached = byParser?.get(parser);
	if (cached) return cached;

	const tree = syntaxTreeAvailable(state, state.doc.length)
		? syntaxTree(state)
		: parser.parse(new DocInput(state.doc));
	const frontmatter = detectFrontmatter(state);
	const ranges: CodeBlockRange[] = [];

	// Visit container children, but never interpret an embedded literal AST as Markdown.
	tree.iterate({
		enter(node) {
			if (frontmatter && node.from < frontmatter.to && node.to > frontmatter.from
				&& node.name !== 'Document') return false;
			if (node.name === 'HTMLBlock' || node.name === 'HTMLTag') return false;
			const fenced = node.name === 'FencedCode';
			if (!fenced && node.name !== 'CodeBlock') return;
			if (fenced) {
				const info = node.node.getChild('CodeInfo');
				const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : '';
				if (isDiagramLang(lang)) return false;
			}
			const first = state.doc.lineAt(node.from);
			if (node.to > first.to && first.number < state.doc.lines) {
				ranges.push({
					blockFrom: node.from,
					openingFrom: first.from,
					firstContentFrom: state.doc.line(first.number + 1).from,
					from: first.to,
					to: node.to,
					fenced,
				});
			}
			return false;
		},
	});

	if (!byParser) {
		byParser = new WeakMap();
		cache.set(state.doc, byParser);
	}
	byParser.set(parser, ranges);
	return ranges;
}
