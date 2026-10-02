import { EditorView, GutterMarker, WidgetType } from '@codemirror/view';
import { t } from '../shared/i18n';

/** Reserves a line for the gutter control replacing hidden reference definitions. */
export class ReferenceDefinitionsWidget extends WidgetType {
	/** @param from Source position to reveal. @param lines Number of hidden source lines. */
	constructor(readonly from: number, readonly lines: number) { super(); }

	eq(other: ReferenceDefinitionsWidget): boolean {
		return this.from === other.from && this.lines === other.lines;
	}

	toDOM(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'mlp-reference-definitions';
		container.setAttribute('aria-hidden', 'true');
		return container;
	}

	ignoreEvent(): boolean { return true; }
}

/** Reveals hidden definitions from the editor's existing folding gutter. */
export class ReferenceDefinitionsMarker extends GutterMarker {
	constructor(private readonly from: number, private readonly lines: number) { super(); }

	eq(other: ReferenceDefinitionsMarker): boolean {
		return this.from === other.from && this.lines === other.lines;
	}

	toDOM(view: EditorView): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.tabIndex = -1;
		button.className = 'mlp-section-fold-toggle mlp-reference-definitions-toggle';
		button.title = t('references.expand', String(this.lines));
		button.setAttribute('aria-label', button.title);
		button.setAttribute('aria-expanded', 'false');
		button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 4 4 4-4 M5 12h14 m-11 8 4-4 4 4"/></svg>';
		// Keep the pointer from moving the editor caret before the click fires.
		button.addEventListener('mousedown', (event) => event.preventDefault());
		button.addEventListener('click', () => {
			view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true, userEvent: 'select.jump' });
			view.focus();
		});
		return button;
	}

}
