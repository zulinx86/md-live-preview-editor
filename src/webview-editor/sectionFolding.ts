import { EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
import { codeFolding, foldedRanges, foldEffect, unfoldEffect, language } from '@codemirror/language';
import { gutter, GutterMarker } from '@codemirror/view';
import { getSectionRanges, sectionAtLine } from './sectionRanges';
import { t } from '../shared/i18n';
import { getCodeBlockRanges } from './codeBlockRanges';
import { ReferenceDefinitionsMarker, ReferenceDefinitionsWidget } from './referenceDefinitionsWidget';
import { cursorTouchesRange } from './cmUtils';

type FoldKind = 'section' | 'code';

function targetAtLine(state: EditorState, lineStart: number): { kind: FoldKind; from: number; to: number } | undefined {
	const section = sectionAtLine(state, lineStart);
	if (section) return { kind: 'section', from: section.from, to: section.to };
	for (const code of getCodeBlockRanges(state)) {
		const opening = state.doc.lineAt(code.openingFrom);
		const fenceHidden = code.fenced && state.doc.lineAt(code.to).number > opening.number + 1
			&& !cursorTouchesRange(state, opening.from, opening.to)
			&& state.sliceDoc(opening.from, code.blockFrom).trim() === '';
		const control = foldedRange(state, code.from) || !fenceHidden ? code.openingFrom : code.firstContentFrom;
		if (lineStart === control) return { kind: 'code', from: code.from, to: code.to };
	}
	return undefined;
}

function foldedRange(state: EditorState, start: number): { from: number; to: number } | undefined {
	let found: { from: number; to: number } | undefined;
	foldedRanges(state).between(start, start, (from, to) => {
		if (from === start) found = { from, to };
	});
	return found;
}

class FoldMarker extends GutterMarker {
	constructor(private readonly collapsed: boolean, private readonly kind: FoldKind) { super(); }
	eq(other: FoldMarker): boolean { return this.collapsed === other.collapsed && this.kind === other.kind; }
	toDOM(): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.tabIndex = -1;
		button.className = 'mlp-section-fold-toggle';
		button.dataset.foldKind = this.kind;
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		icon.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M5 3 L10 8 L5 13');
		icon.appendChild(path);
		button.appendChild(icon);
		button.title = this.kind === 'code'
			? t(this.collapsed ? 'code.expand' : 'code.collapse')
			: t(this.collapsed ? 'section.expand' : 'section.collapse');
		button.setAttribute('aria-label', button.title);
		button.setAttribute('aria-expanded', String(!this.collapsed));
		return button;
	}
}

const markers = {
	section: { expanded: new FoldMarker(false, 'section'), collapsed: new FoldMarker(true, 'section') },
	code: { expanded: new FoldMarker(false, 'code'), collapsed: new FoldMarker(true, 'code') },
};

/** Section and code controls share mapped fold state, navigation, and one gutter. */
export const sectionFolding: Extension = [
	EditorState.transactionExtender.of(transaction => {
		if (foldedRanges(transaction.startState).size === 0) return null;
		const effects: StateEffect<{ from: number; to: number }>[] = [];
		if (transaction.docChanged) {
			// Position mapping handles ordinary edits; reveal structurally stale folds.
			const ranges = [...getSectionRanges(transaction.state), ...getCodeBlockRanges(transaction.state)];
			const valid = new Set(ranges.map(range => `${range.from}:${range.to}`));
			foldedRanges(transaction.state).between(0, transaction.newDoc.length, (from, to) => {
				if (!valid.has(`${from}:${to}`)) effects.push(unfoldEffect.of({ from, to }));
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
		initialSpacer: () => markers.section.collapsed,
		lineMarker(view, line) {
			const target = targetAtLine(view.state, line.from);
			if (!target) return null;
			return markers[target.kind][foldedRange(view.state, target.from) ? 'collapsed' : 'expanded'];
		},
		widgetMarker(_view, widget) {
			return widget instanceof ReferenceDefinitionsWidget
				? new ReferenceDefinitionsMarker(widget.from, widget.lines) : null;
		},
		lineMarkerChange: update => update.docChanged || update.selectionSet
			|| foldedRanges(update.startState) !== foldedRanges(update.state)
			|| update.startState.facet(language) !== update.state.facet(language),
		domEventHandlers: {
			mousedown: (_view, _line, event) => { event.preventDefault(); return true; },
			click(view, line, event) {
				if ((event.target as Element).closest('.mlp-reference-definitions-toggle')) return true;
				const target = targetAtLine(view.state, line.from);
				if (!target) return false;
				const folded = foldedRange(view.state, target.from);
				view.dispatch({ effects: folded ? unfoldEffect.of(folded) : foldEffect.of(target) });
				view.focus();
				return true;
			},
		},
	}),
];
