import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { BlockType, EditorView, layer, RectangleMarker, type BlockInfo } from '@codemirror/view';

function* widgetBlocks(blocks: readonly BlockInfo[]): Iterable<BlockInfo> {
	for (const block of blocks) {
		if (Array.isArray(block.type)) yield* widgetBlocks(block.type);
		else if (block.type === BlockType.WidgetRange && block.height > 0) yield block;
	}
}

/** Draw selection backgrounds per source line instead of filling past newlines. */
export const textSelection: Extension = [
	// Retain drawSelection's native cursor layer and selection handling, replacing
	// only its background. Keep this layer above code backgrounds at z-index -2.
	Prec.high(layer({
		above: false,
		class: 'mlp-text-selection-layer',
		mount: element => element.classList.add('cm-selectionLayer'),
		update: update => update.docChanged || update.selectionSet || update.viewportChanged,
		markers(view) {
			const markers: RectangleMarker[] = [];
			const widgets = [...widgetBlocks(view.viewportLineBlocks)];
			const baseTop = view.scrollDOM.getBoundingClientRect().top - view.scrollDOM.scrollTop * view.scaleY;
			for (const selection of view.state.selection.ranges) {
				if (selection.empty) continue;
				// Retain the native coverage across rendered blocks, whose replaced
				// source does not occur in visibleRanges. Inline folds stay excluded.
				const selectedWidgets = widgets.filter(block => block.from < selection.to && block.to > selection.from);
				if (selectedWidgets.length) {
					const native = RectangleMarker.forRange(view, 'cm-selectionBackground', selection);
					for (const block of selectedWidgets) {
						const top = view.documentTop + block.top * view.scaleY - baseTop;
						const bottom = top + block.height * view.scaleY;
						for (const rectangle of native) {
							const start = Math.max(top, rectangle.top);
							const end = Math.min(bottom, rectangle.top + rectangle.height);
							if (end > start) markers.push(new RectangleMarker('cm-selectionBackground', rectangle.left, start, rectangle.width, end - start));
						}
					}
				}
				for (const visible of view.visibleRanges) {
					const end = Math.min(selection.to, visible.to);
					let position = Math.max(selection.from, visible.from);
					while (position < end) {
						const line = view.state.doc.lineAt(position);
						const to = Math.min(line.to, end);
						if (to > position) {
							markers.push(...RectangleMarker.forRange(view, 'cm-selectionBackground', EditorSelection.range(position, to)));
						}
						// Mark a hard newline only when that character is selected.
						// Wrapped visual lines and EOF do not have a newline here.
						if (line.to < end) {
							for (const cursor of RectangleMarker.forRange(view, 'cm-selectionBackground', EditorSelection.cursor(line.to, -1))) {
								if (cursor.height > 0) markers.push(new RectangleMarker('cm-selectionBackground mlp-selected-newline', cursor.left, cursor.top,
									view.defaultCharacterWidth, cursor.height));
							}
						}
						position = line.to + 1;
					}
				}
			}
			return markers;
		},
	})),
	EditorView.theme({
		'.cm-selectionLayer:not(.mlp-text-selection-layer)': { display: 'none' },
	}),
];
