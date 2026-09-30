import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view';
import { computeGitDiffHunks, type GitDiffHunk, type GitLineChange } from '../shared/gitLineChanges';
import { GitDiffPreview } from './gitDiffPreview';
import { t } from '../shared/i18n';

export const setGitBase = StateEffect.define<string | null>();

const gitDiffState = StateField.define<{ base: string | null; hunks: GitDiffHunk[] }>({
	create: () => ({ base: null, hunks: [] }),
	update(value, transaction) {
		let base = value.base;
		for (const effect of transaction.effects) if (effect.is(setGitBase)) base = effect.value;
		if (!transaction.docChanged && base === value.base) return value;
		return { base, hunks: base === null ? [] : computeGitDiffHunks(base, transaction.newDoc.toString()) };
	},
});

const showGitPreview = StateEffect.define<{ at: number; indices: number[] } | null>();
const gitPreviewState = StateField.define<{ key: string; decorations: DecorationSet }>({
	create: () => ({ key: '', decorations: Decoration.none }),
	update(value, transaction) {
		// Editing or a new HEAD invalidates the snapshot being inspected.
		if (transaction.docChanged || transaction.effects.some(effect => effect.is(setGitBase))) {
			return { key: '', decorations: Decoration.none };
		}
		for (const effect of transaction.effects) if (effect.is(showGitPreview)) {
			if (!effect.value) return { key: '', decorations: Decoration.none };
			const { at, indices } = effect.value;
			const hunks = transaction.state.field(gitDiffState).hunks;
			return {
				key: indices.join(','),
				decorations: Decoration.set([Decoration.widget({
					block: true, side: 1,
					widget: new GitDiffPreview(indices.map(index => hunks[index]), view => view.dispatch({ effects: showGitPreview.of(null) })),
				}).range(at)]),
			};
		}
		return value;
	},
	provide: field => EditorView.decorations.from(field, value => value.decorations),
});

class ChangeMarker extends GutterMarker {
	constructor(private readonly kind: GitLineChange['kind'], private readonly side: string,
		private readonly at: number, private readonly indices: number[], private readonly expanded: boolean) {
		super();
	}

	eq(other: ChangeMarker): boolean {
		return this.kind === other.kind && this.side === other.side && this.at === other.at
			&& this.indices.join(',') === other.indices.join(',') && this.expanded === other.expanded;
	}

	toDOM(view: EditorView): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mlp-git-change-button';
		button.title = t('git.preview');
		button.setAttribute('aria-label', t('git.preview'));
		button.setAttribute('aria-expanded', String(this.expanded));
		button.addEventListener('mousedown', event => event.preventDefault());
		button.addEventListener('click', () => {
			const hadFocus = button === button.ownerDocument.activeElement;
			view.dispatch({ effects: showGitPreview.of(this.expanded ? null : { at: this.at, indices: this.indices }) });
			// Reconciliation replaces this marker. Keep keyboard focus in the UI.
			if (hadFocus) {
				const close = view.dom.querySelector<HTMLButtonElement>('.mlp-git-preview-close');
				if (close) close.focus();
				else view.focus();
			}
		});
		const marker = button.appendChild(document.createElement('span'));
		marker.className = `mlp-git-marker mlp-git-${this.kind} mlp-git-${this.side}`;
		return button;
	}
}

function markerFor(view: EditorView, from: number, to: number, widget = false): GutterMarker | null {
	const doc = view.state.doc;
	const first = doc.lineAt(from).number;
	const last = doc.lineAt(to).number;
	const indices: number[] = [];
	const changes = view.state.field(gitDiffState).hunks.flatMap((hunk, index) => {
		if (hunk.change.fromLine > last || hunk.change.toLine < first) return [];
		indices.push(index);
		return [hunk.change];
	});
	if (!changes.length) return null;
	// A rendered table/diagram may cover multiple source hunks. Show that the block changed.
	let kind = changes.every((change) => change.kind === changes[0].kind) ? changes[0].kind : 'modified';
	if (widget && kind === 'deleted') {
		const change = changes[0];
		const atBoundary = change.side === 'after' ? change.fromLine === last : change.fromLine === first;
		// A pointer can describe a widget boundary, but not an internal row or several gaps.
		if (!atBoundary || changes.length > 1) kind = 'modified';
	}
	return new ChangeMarker(kind, changes[0].side ?? 'before', doc.lineAt(to).to, indices,
		view.state.field(gitPreviewState).key === indices.join(','));
}

/** Git markers follow source positions while CodeMirror handles wrapping and widgets. */
export const gitDiffGutter: Extension = [
	gitDiffState,
	gitPreviewState,
	gutter({
		class: 'mlp-git-gutter',
		lineMarker: (view, line) => markerFor(view, line.from, line.to),
		widgetMarker: (view, widget, block) => widget instanceof GitDiffPreview ? null : markerFor(view, block.from, block.to, true),
		lineMarkerChange: (update) => update.startState.field(gitDiffState) !== update.state.field(gitDiffState)
			|| update.startState.field(gitPreviewState) !== update.state.field(gitPreviewState),
	}),
];
