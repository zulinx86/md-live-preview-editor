import { EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
import { codeFolding, foldedRanges, foldEffect, unfoldEffect, language } from '@codemirror/language';
import { gutter, GutterMarker } from '@codemirror/view';
import { getSectionRanges, sectionAtLine, type SectionRange } from './sectionRanges';
import { t } from '../shared/i18n';

function foldedSection(state: EditorState, section: SectionRange): { from: number; to: number } | undefined {
	let found: { from: number; to: number } | undefined;
	foldedRanges(state).between(section.from, section.from, (from, to) => {
		if (from === section.from) found = { from, to };
	});
	return found;
}

class SectionMarker extends GutterMarker {
	constructor(private readonly collapsed: boolean) { super(); }
	eq(other: SectionMarker): boolean { return this.collapsed === other.collapsed; }
	toDOM(): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.tabIndex = -1;
		button.className = 'mlp-section-fold-toggle';
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		icon.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M5 3 L10 8 L5 13');
		icon.appendChild(path);
		button.appendChild(icon);
		button.title = t(this.collapsed ? 'section.expand' : 'section.collapse');
		button.setAttribute('aria-label', button.title);
		button.setAttribute('aria-expanded', String(!this.collapsed));
		return button;
	}
}

const expandedMarker = new SectionMarker(false);
const collapsedMarker = new SectionMarker(true);

/** Heading-only controls backed by CodeMirror's mapped fold state and auto-unfolding. */
export const sectionFolding: Extension = [
	EditorState.transactionExtender.of(transaction => {
		if (foldedRanges(transaction.startState).size === 0) return null;
		const effects: StateEffect<{ from: number; to: number }>[] = [];
		if (transaction.docChanged) {
			// Position mapping handles ordinary edits; reveal structurally stale folds.
			const sections = new Map(getSectionRanges(transaction.state).map(section => [section.from, section.to]));
			foldedRanges(transaction.state).between(0, transaction.newDoc.length, (from, to) => {
				if (sections.get(from) !== to) effects.push(unfoldEffect.of({ from, to }));
			});
		}
		// Native auto-unfolding excludes the endpoint. An explicit jump or search
		// ending on the last hidden character still needs that line revealed.
		if (transaction.isUserEvent('select.jump') || transaction.isUserEvent('select.restore')
			|| transaction.isUserEvent('select.search')) {
			const head = transaction.state.selection.main.head;
			foldedRanges(transaction.state).between(head, head, (from, to) => {
				if (from < head && to === head) effects.push(unfoldEffect.of({ from, to }));
			});
		}
		return effects.length ? { effects } : null;
	}),
	// Outer section folds must take precedence over rendered tables and diagrams.
	Prec.high(codeFolding({
		placeholderDOM: () => document.createElement('span'),
	})),
	gutter({
		class: 'mlp-section-fold-gutter',
		initialSpacer: () => collapsedMarker,
		lineMarker(view, line) {
			const section = sectionAtLine(view.state, line.from);
			return section ? foldedSection(view.state, section) ? collapsedMarker : expandedMarker : null;
		},
		lineMarkerChange: update => update.docChanged
			|| foldedRanges(update.startState) !== foldedRanges(update.state)
			|| update.startState.facet(language) !== update.state.facet(language),
		domEventHandlers: {
			mousedown: (_view, _line, event) => { event.preventDefault(); return true; },
			click(view, line) {
				const section = sectionAtLine(view.state, line.from);
				if (!section) return false;
				const folded = foldedSection(view.state, section);
				view.dispatch({ effects: folded ? unfoldEffect.of(folded) : foldEffect.of(section) });
				view.focus();
				return true;
			},
		},
	}),
];
