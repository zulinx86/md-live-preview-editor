import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { gutter, GutterMarker, type EditorView } from '@codemirror/view';
import { computeGitLineChanges, type GitLineChange } from '../shared/gitLineChanges';

export const setGitBase = StateEffect.define<string | null>();

const gitDiffState = StateField.define<{ base: string | null; changes: GitLineChange[] }>({
	create: () => ({ base: null, changes: [] }),
	update(value, transaction) {
		let base = value.base;
		for (const effect of transaction.effects) if (effect.is(setGitBase)) base = effect.value;
		if (!transaction.docChanged && base === value.base) return value;
		return { base, changes: base === null ? [] : computeGitLineChanges(base, transaction.newDoc.toString()) };
	},
});

class ChangeMarker extends GutterMarker {
	constructor(private readonly kind: GitLineChange['kind'], private readonly side = 'before') {
		super();
	}

	eq(other: ChangeMarker): boolean {
		return this.kind === other.kind && this.side === other.side;
	}

	toDOM(): HTMLElement {
		const marker = document.createElement('span');
		marker.className = `mlp-git-marker mlp-git-${this.kind} mlp-git-${this.side}`;
		marker.title = `${this.kind === 'added' ? 'Added' : this.kind === 'modified' ? 'Modified' : 'Deleted'} since HEAD`;
		return marker;
	}
}

function markerFor(view: EditorView, from: number, to: number, widget = false): GutterMarker | null {
	const doc = view.state.doc;
	const first = doc.lineAt(from).number;
	const last = doc.lineAt(to).number;
	const changes = view.state.field(gitDiffState).changes
		.filter((change) => change.fromLine <= last && change.toLine >= first);
	if (!changes.length) return null;
	// A rendered table/diagram may cover multiple source hunks. Show that the block changed.
	let kind = changes.every((change) => change.kind === changes[0].kind) ? changes[0].kind : 'modified';
	if (widget && kind === 'deleted') {
		const change = changes[0];
		const atBoundary = change.side === 'after' ? change.fromLine === last : change.fromLine === first;
		// A pointer can describe a widget boundary, but not an internal row or several gaps.
		if (!atBoundary || changes.length > 1) kind = 'modified';
	}
	return new ChangeMarker(kind, changes[0].side);
}

/** Git markers follow source positions while CodeMirror handles wrapping and widgets. */
export const gitDiffGutter: Extension = [
	gitDiffState,
	gutter({
		class: 'mlp-git-gutter',
		lineMarker: (view, line) => markerFor(view, line.from, line.to),
		widgetMarker: (view, _widget, block) => markerFor(view, block.from, block.to, true),
		lineMarkerChange: (update) => update.startState.field(gitDiffState) !== update.state.field(gitDiffState),
	}),
];
