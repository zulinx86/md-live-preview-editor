import type { EditorState } from '@codemirror/state';
import { DocInput, language } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import GithubSlugger from 'github-slugger';
import { decodeHTMLStrict } from 'entities';
import { detectFrontmatter } from './frontmatterWidget';
import { getLinkReferences, resolveMarkdownLink, type LinkReferences } from './markdownLinks';

type ReadSource = (from: number, to: number) => string;
const syntaxOnly = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HTMLTag']);

// Build heading IDs from visible text, excluding markup and link destinations.
function headingText(node: SyntaxNode, read: ReadSource, references: LinkReferences,
	from = node.from, to = node.to): string {
	if (syntaxOnly.has(node.name)) return '';
	if (node.name === 'Entity') return decodeHTMLStrict(read(from, to));
	if (node.name === 'Escape') return read(from + 1, to);
	if ((node.name === 'Link' || node.name === 'Image') && from === node.from) {
		const link = resolveMarkdownLink(node, read, references);
		if (link) return headingText(node, read, references, link.labelFrom, link.labelTo);
	}
	let text = '';
	let pos = from;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.from < from || child.to > to) continue;
		text += read(pos, child.from) + headingText(child, read, references);
		pos = child.to;
	}
	return text + read(pos, to);
}

/**
 * Resolves a fragment-only href against headings in the current editor state.
 * Returns a source offset, zero for '#', or null when no heading matches.
 * Uses a complete parse so offscreen headings and duplicate IDs are included.
 */
export function findFragmentPosition(state: EditorState, href: string): number | null {
	if (!href.startsWith('#')) return null;
	let fragment = href.slice(1);
	try { fragment = decodeURIComponent(fragment); } catch { return null; }
	if (!fragment) return 0;
	const parser = state.facet(language)?.parser;
	if (!parser) return null;
	const tree = parser.parse(new DocInput(state.doc));
	const references = getLinkReferences(state);
	const frontmatter = detectFrontmatter(state);
	const slugger = new GithubSlugger();
	let position: number | null = null;
	tree.iterate({
		enter(node) {
			if (position !== null) return false;
			if (!/^(ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) return;
			if (frontmatter && node.from < frontmatter.to) return false;
			const text = headingText(node.node, (from, to) => state.sliceDoc(from, to), references).trim().replace(/\r?\n/g, ' ');
			if (slugger.slug(text) === fragment.toLowerCase()) position = node.from;
			return false;
		},
	});
	return position;
}
