import { EditorState, Annotation, type Extension, ChangeSet } from '@codemirror/state';
import { EditorView, keymap, drawSelection, lineNumbers } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
	search,
	closeSearchPanel,
	searchKeymap,
	findNext,
	findPrevious,
	selectNextOccurrence,
} from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { livePreviewPlugin, createLinkClickHandler, setImageBaseUri } from './livePreviewPlugin';
import { codeHighlightExtension, setCodeTokens } from './codeHighlightPlugin';
import { blockDecorationsField, dragReleaseRefresh } from './blockDecorations';
import { detectFrontmatter } from './frontmatterWidget';
import { headingSpaceInputHandler } from './headingSpacePlugin';
import { backtickInputHandler } from './backtickPairPlugin';
import { toggleEmphasisCommand } from './emphasisShortcuts';
import { createImagePasteHandler } from './imagePasteHandler';
import { postToHost, onHostMessage } from './vscodeApi';
import { setDrawioFilePoster, handleDrawioFileMessage, clearDrawioFileCache } from './drawioFileClient';
import {
	searchRevealExtension,
	markingSearchSelection,
	openSearchPanelFocused,
} from './searchReveal';
import { t } from '../shared/i18n';
import { adaptMarkdownCss } from '../shared/cssAdapter';
import type { TextChange } from '../shared/messages';
import { allowRevealOnce } from './cmUtils';
import { gitDiffGutter, setGitBase } from './gitDiffGutter';
import { sectionFolding } from './sectionFolding';
import { textSelection } from './textSelection';
import { findFragmentPosition } from './fragmentNavigation';

const remoteChange = Annotation.define<boolean>();
const FLUSH_DEBOUNCE_MS = 250;

let view: EditorView | undefined;
let baseVersion = 0;
let pending: ChangeSet | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
	flushTimer = undefined;
	if (!view || !pending || pending.empty) {
		pending = null;
		return;
	}
	const changes: TextChange[] = [];
	pending.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		changes.push({ from: fromA, to: toA, insert: inserted.toString() });
	});
	pending = null;
	postToHost({ type: 'edit', baseVersion, changes });
}

function scheduleFlush() {
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function flushNow() {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	flush();
}

function applyUserCss(css: string) {
	let styleEl = document.getElementById('mlp-user-css') as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'mlp-user-css';
		document.head.appendChild(styleEl);
	}
	styleEl.textContent = adaptMarkdownCss(css);
}

function jumpToPosition(editor: EditorView, pos: number): void {
	allowRevealOnce();
	editor.dispatch({
		selection: { anchor: pos },
		effects: EditorView.scrollIntoView(pos, { y: 'center' }),
		userEvent: 'select.jump',
	});
	editor.focus();
}

function openLink(href: string): void {
	const target = href.trim();
	if (target.startsWith('#')) {
		if (!view) return;
		const pos = findFragmentPosition(view.state, target);
		if (pos !== null) jumpToPosition(view, pos);
		return;
	}
	postToHost({ type: 'openLink', href });
}

function createExtensions(): Extension[] {
	const markdownSupport = markdown({ extensions: GFM });
	return [
		markdownSupport,
		// Extend closeBrackets' default pair set (`( [ { ' "`) with the emphasis
		// marks so `*bold/italic*` and `_italic_` also auto-pair and wrap a
		// selection when typed — the same mechanism VS Code and most editors use
		// for quotes. Backtick is deliberately left out here: it's handled by its
		// own `backtickInputHandler` below (see that file for why).
		markdownSupport.language.data.of({ closeBrackets: { brackets: ['(', '[', '{', "'", '"', '*', '_'] } }),
		closeBrackets(),
		headingSpaceInputHandler,
		backtickInputHandler,
		livePreviewPlugin,
		blockDecorationsField,
		dragReleaseRefresh,
		codeHighlightExtension,
		createLinkClickHandler(openLink),
		createImagePasteHandler((atPos, mimeType, dataBase64, needsOwnParagraph) =>
			postToHost({ type: 'pasteImage', atPos, mimeType, dataBase64, needsOwnParagraph }),
		),
		// Without this a state keeps only one selection range, so Mod-d's
		// multi-cursor search silently collapses to a single cursor — and the
		// multiple-cursor behaviour Ctrl+B/Ctrl+I already document never had a way
		// to arise. `drawSelection` renders the extra carets, which the browser's
		// native selection cannot show.
		EditorState.allowMultipleSelections.of(true),
		drawSelection(),
		textSelection,
		lineNumbers(),
		gitDiffGutter,
		sectionFolding,
		// Search matches the raw Markdown, which is what the file actually holds —
		// so `](url)` and a table's pipes are findable even while the preview
		// hides them. `searchRevealExtension` is what makes a match inside hidden
		// syntax actually show itself; see that file.
		search({ top: true }),
		searchRevealExtension,
		// The panel builds its own labels, so they are localized through
		// CodeMirror's phrases facet rather than by rendering them ourselves.
		EditorState.phrases.of({
			Find: t('search.find'),
			Replace: t('search.replace'),
			next: t('search.next'),
			previous: t('search.previous'),
			all: t('search.all'),
			'match case': t('search.matchCase'),
			regexp: t('search.regexp'),
			'by word': t('search.byWord'),
			replace: t('search.replaceButton'),
			'replace all': t('search.replaceAll'),
			close: t('search.close'),
			'current match': t('search.currentMatch'),
			'Go to line': t('search.gotoLine'),
			go: t('search.go'),
			'on line': t('search.onLine'),
		}),
		keymap.of([
			...closeBracketsKeymap,
			// Bound ahead of the defaults below so Mod-f reaches the panel rather
			// than any other handler, and so each jump can mark its selection as a
			// search match. Replace has no default binding in searchKeymap; VS Code
			// puts it on Mod-Alt-f, and the panel carries both fields either way.
			{ key: 'Mod-f', run: openSearchPanelFocused },
			{ key: 'Mod-Alt-f', run: openSearchPanelFocused },
			{ key: 'F3', run: markingSearchSelection(findNext), shift: markingSearchSelection(findPrevious) },
			{ key: 'Mod-g', run: markingSearchSelection(findNext), shift: markingSearchSelection(findPrevious) },
			{ key: 'Mod-d', run: markingSearchSelection(selectNextOccurrence) },
			// Escape closes the panel; it must not swallow the key when no panel is
			// open, so `closeSearchPanel`'s own false return is passed through.
			{ key: 'Escape', run: closeSearchPanel },
			// While focus is inside the panel the editor's own keymap never sees the
			// key: the panel routes what it receives through the "search-panel"
			// scope, which only these bindings serve. Without them Escape did
			// nothing once the field had focus.
			...searchKeymap.filter((binding) => binding.key === 'Escape'),
			// Flush any not-yet-sent keystrokes before asking the host to undo/redo —
			// otherwise the host's document is missing the latest edits when it acts,
			// undoing the wrong change and leaving the webview's local text duplicated
			// relative to what ends up in the file.
			{ key: 'Mod-z', run: () => { flushNow(); postToHost({ type: 'undo' }); return true; } },
			{ key: 'Mod-y', run: () => { flushNow(); postToHost({ type: 'redo' }); return true; } },
			{ key: 'Mod-Shift-z', run: () => { flushNow(); postToHost({ type: 'redo' }); return true; } },
			{ key: 'Mod-b', run: toggleEmphasisCommand('**') },
			{ key: 'Mod-i', run: toggleEmphasisCommand('*') },
			indentWithTab,
			...defaultKeymap,
		]),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			const isRemote = update.transactions.some((tr) => tr.annotation(remoteChange));
			if (isRemote) return;
			pending = pending ? pending.compose(update.changes) : update.changes;
			scheduleFlush();
		}),
		EditorView.domEventHandlers({
			blur: () => flushNow(),
		}),
		EditorView.lineWrapping,
	];
}

// A fresh EditorState's selection defaults to position 0 — i.e. line 1 — which
// is exactly where a leading frontmatter block's own range starts. Left as-is,
// `cursorTouchesRange` would read that default as "the cursor is touching the
// frontmatter block" and keep it as raw source on every load, never rendering
// the table until the user happened to move the cursor away first. Placing the
// initial selection just past the block (only when one is actually present)
// avoids that without touching the general cursor-reveals-source behavior.
// `fm.to` is the *end of the closing "---" line itself* (correct for the
// decoration range), so it's still on that line — the anchor must go one
// further, past its line break, to actually land outside the block.
function initialStateFor(text: string): EditorState {
	const state = EditorState.create({ doc: text, extensions: createExtensions() });
	const fm = detectFrontmatter(state);
	if (!fm) return state;
	const anchor = Math.min(fm.to + 1, state.doc.length);
	return state.update({ selection: { anchor } }).state;
}

function createView(text: string) {
	const root = document.getElementById('mlp-root')!;
	view = new EditorView({
		state: initialStateFor(text),
		parent: root,
	});
}

function resetView(text: string) {
	if (!view) {
		createView(text);
		return;
	}
	pending = null;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	view.setState(initialStateFor(text));
}

// The drawio file client cannot reach the host on its own (it is imported by
// widget code that has no business acquiring the VS Code API); hand it the
// poster this module already owns.
setDrawioFilePoster((message) => postToHost(message as Parameters<typeof postToHost>[0]));

onHostMessage((message) => {
	// `drawioFile` replies are routed to whichever widget requested them, not
	// handled by the switch below.
	if (handleDrawioFileMessage(message)) return;
	switch (message.type) {
		case 'init':
			baseVersion = message.version;
			setImageBaseUri(message.baseUri);
			applyUserCss(message.css);
			// A re-init means a different document (or the same one reloaded), so
			// files read for the previous one must not be served from cache.
			clearDrawioFileCache();
			resetView(message.text);
			view?.dispatch({ effects: setGitBase.of(message.gitBase ?? null) });
			break;
		case 'ackEdit':
			baseVersion = message.version;
			break;
		case 'externalUpdate': {
			if (!view) return;
			pending = null;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			view.dispatch({
				changes: message.changes,
				annotations: remoteChange.of(true),
			});
			baseVersion = message.version;
			break;
		}
		case 'gitBase':
			view?.dispatch({ effects: setGitBase.of(message.text) });
			break;
		case 'codeTokens':
			view?.dispatch({ effects: setCodeTokens.of(message.blocks), annotations: remoteChange.of(true) });
			break;
		case 'applyCss':
			applyUserCss(message.css);
			break;
		case 'requestSelection': {
			if (!view) return;
			flushNow();
			const { anchor, head } = view.state.selection.main;
			postToHost({ type: 'selection', requestId: message.requestId, selection: { anchor, head } });
			break;
		}
		case 'restoreSelection': {
			if (!view) return;
			const { anchor, head } = message.selection;
			if (!Number.isSafeInteger(anchor) || !Number.isSafeInteger(head)) return;
			const length = view.state.doc.length;
			const clamp = (offset: number) => Math.min(Math.max(offset, 0), length);
			allowRevealOnce();
			view.dispatch({
				selection: { anchor: clamp(anchor), head: clamp(head) },
				effects: EditorView.scrollIntoView(clamp(head), { y: 'center' }),
				userEvent: 'select.restore',
			});
			view.focus();
			break;
		}
		case 'jumpToFragment': {
			if (!view) return;
			const pos = findFragmentPosition(view.state, message.fragment);
			if (pos !== null) jumpToPosition(view, pos);
			break;
		}
		case 'jumpToLine': {
			if (!view) return;
			const { doc } = view.state;
			if (!Number.isSafeInteger(message.line) || message.line < 1 || message.line > doc.lines) return;
			const column = message.column ?? 1;
			if (!Number.isSafeInteger(column) || column < 1) return;
			const line = doc.line(message.line);
			const pos = line.from + Math.min(column - 1, line.length);
			// A requested source location is deliberate, unlike a stray block click.
			jumpToPosition(view, pos);
			break;
		}
		case 'setCursor': {
			if (!view) return;
			const pos = Math.max(0, Math.min(message.pos, view.state.doc.length));
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: 'select.jump' });
			break;
		}
	}
});

postToHost({ type: 'ready' });
