import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

/** Select whole source lines from the number gutter, including their newline. */
export const selectableLineNumbers: Extension = (() => {
	const starts = new WeakMap<MouseEvent, number>();
	return [
		lineNumbers({ domEventHandlers: {
			mousedown(view, block, event) {
				if (!(event instanceof MouseEvent) || event.button !== 0) return false;
				// Forward into the editor's native mouse-selection lifecycle so it
				// owns dragging, auto-scroll, focus, and listener cleanup. Triple-click
				// semantics prevent dragging existing selected text from the gutter.
				const forwarded = new MouseEvent('mousedown', {
					bubbles: true, cancelable: true, detail: 3,
					clientX: event.clientX, clientY: event.clientY,
					button: event.button, buttons: event.buttons,
					shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
					metaKey: event.metaKey, altKey: event.altKey,
				});
				starts.set(forwarded, block.from);
				view.contentDOM.dispatchEvent(forwarded);
				return true;
			},
		} }),
		EditorView.mouseSelectionStyle.of((view, event) => {
			const position = starts.get(event);
			if (position === undefined) return null;
			let start = position;
			let original = view.state.selection;
			return {
				get(current, extend, multiple) {
					const doc = view.state.doc;
					const position = current === event ? start : view.lineBlockAtHeight(current.clientY - view.documentTop).from;
					const target = doc.lineAt(position);
					// A backward selection ends its anchor line at the next line start.
					const anchorPosition = original.main.anchor > original.main.head
						? original.main.anchor - 1 : original.main.anchor;
					const anchor = doc.lineAt(extend ? anchorPosition : start);
					const end = (line: typeof anchor) => Math.min(doc.length, line.to + 1);
					const range = target.from < anchor.from
						? EditorSelection.range(end(anchor), target.from)
						: EditorSelection.range(anchor.from, end(target));
					return multiple ? original.addRange(range) : EditorSelection.create([range]);
				},
				update(update) {
					if (update.docChanged) {
						start = update.changes.mapPos(start);
						original = original.map(update.changes);
					}
				},
			};
		}),
	];
})();
