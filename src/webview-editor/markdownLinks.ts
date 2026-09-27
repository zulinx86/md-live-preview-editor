import type { EditorState, Text } from '@codemirror/state';
import { DocInput, language } from '@codemirror/language';
import type { Parser, SyntaxNode } from '@lezer/common';
import { decodeHTMLStrict } from 'entities';
import { detectFrontmatter } from './frontmatterWidget';

export interface LinkTarget {
	readonly href: string;
	readonly title?: string;
}

export interface ResolvedLink extends LinkTarget {
	readonly labelFrom: number;
	readonly labelTo: number;
}

export type LinkReferences = ReadonlyMap<string, LinkTarget>;

type ReadSource = (from: number, to: number) => string;

const emptyReferences: LinkReferences = new Map();
const referenceCache = new WeakMap<Text, WeakMap<Parser, LinkReferences>>();

// Labels are matched as source: escapes and entities are deliberately not decoded.
function normalizeLabel(label: string): string {
	return label.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}

function decodeLinkText(text: string): string {
	// Decode each source token once. An escaped ampersand must not start an
	// entity, and punctuation produced by an entity must not become an escape.
	return text.replace(/\\([!-/:-@\[-`{-~])|&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(token, escaped: string | undefined) => escaped ?? decodeHTMLStrict(token));
}

function readTarget(node: SyntaxNode, read: ReadSource): LinkTarget {
	const url = node.getChild('URL');
	let href = url ? read(url.from, url.to) : '';
	if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
	const title = node.getChild('LinkTitle');
	return {
		href: decodeLinkText(href),
		...(title ? { title: decodeLinkText(read(title.from + 1, title.to - 1)) } : {}),
	};
}

/**
 * Resolves a parsed Link/Image using its source reader and document references.
 * Returns label offsets in the reader's coordinates and the decoded target,
 * or null for undefined bracket labels. An empty href is a valid destination.
 */
export function resolveMarkdownLink(
	node: SyntaxNode,
	read: ReadSource,
	references: LinkReferences,
): ResolvedLink | null {
	if (node.name !== 'Link' && node.name !== 'Image') return null;
	const marks = node.getChildren('LinkMark');
	if (marks.length < 2) return null;
	const labelFrom = marks[0].to;
	const labelTo = marks[1].from;

	// A completed inline destination has parenthesis marks even for `()`.
	if (marks.length === 4 && read(marks[2].from, marks[2].to) === '(' && read(marks[3].from, marks[3].to) === ')') {
		return { labelFrom, labelTo, ...readTarget(node, read) };
	}

	const reference = node.getChild('LinkLabel');
	const explicitLabel = reference ? read(reference.from + 1, reference.to - 1) : '';
	const label = reference && explicitLabel !== '' ? explicitLabel : read(labelFrom, labelTo);
	const target = references.get(normalizeLabel(label));
	return target ? { labelFrom, labelTo, ...target } : null;
}

/**
 * Returns all link definitions for state's complete document and configured
 * language parser, excluding frontmatter. The first definition of a label wins.
 * Parsing and collection are cached by immutable document and parser identity,
 * so selection-only states and multiple renderers reuse the same readonly map.
 */
export function getLinkReferences(state: EditorState): LinkReferences {
	const parser = state.facet(language)?.parser;
	if (!parser) return emptyReferences;
	let byParser = referenceCache.get(state.doc);
	const cached = byParser?.get(parser);
	if (cached) return cached;

	// The editor's incremental tree may not yet cover definitions below the
	// viewport. Parse the complete document once, without forcing view updates.
	const tree = parser.parse(new DocInput(state.doc));
	const frontmatter = detectFrontmatter(state);
	const references = new Map<string, LinkTarget>();
	const read: ReadSource = (from, to) => state.sliceDoc(from, to);
	tree.iterate({
		enter(node) {
			if (node.name !== 'LinkReference') return;
			if (frontmatter && node.from < frontmatter.to && node.to > frontmatter.from) return false;
			const label = node.node.getChild('LinkLabel');
			if (label && node.node.getChild('URL')) {
				const key = normalizeLabel(read(label.from + 1, label.to - 1));
				if (!references.has(key)) references.set(key, readTarget(node.node, read));
			}
			return false;
		},
	});
	if (!byParser) referenceCache.set(state.doc, byParser = new WeakMap());
	byParser.set(parser, references);
	return references;
}

/** Returns the destination for a parser-recognized bare or angle autolink. */
export function autolinkHref(text: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
	return text.startsWith('www.') ? `http://${text}` : `mailto:${text}`;
}
