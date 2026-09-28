import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { EditorToHostMessage, HostToEditorMessage } from '../shared/messages';
import { DocumentSyncSession } from './documentSync';
import { tokenizeDocument } from './shikiHost';

vi.mock('vscode', () => ({
	Position: class {
		constructor(public line: number, public character: number) {
			if (line < 0 || character < 0) throw new Error('Position must be nonnegative');
		}
	},
	Uri: {
		joinPath: vi.fn(() => ({ toString: () => 'file:///workspace' })),
	},
	workspace: {
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		fs: { stat: vi.fn().mockResolvedValue({ type: 1 }) },
	},
	commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
	env: { openExternal: vi.fn().mockResolvedValue(true) },
	l10n: { t: (message: string) => message },
	window: {
		onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
		showWarningMessage: vi.fn(),
	},
}));

vi.mock('./shikiHost', () => ({
	pickCodeTheme: vi.fn(() => 'dark-plus'),
	tokenizeDocument: vi.fn(async () => []),
}));

const sessions: DocumentSyncSession[] = [];

function createSession(text = 'first\n📚 notes\nlast') {
	const lines = text.split('\n');
	let receive!: (message: EditorToHostMessage) => void;
	const postMessage = vi.fn<(message: HostToEditorMessage) => Promise<boolean>>().mockResolvedValue(true);
	// Mimic TextDocument's bounds handling, including EOF when the line is past
	// the document. Assertions below also check the zero-based input position.
	const validatePosition = vi.fn((position: vscode.Position) => {
		const line = Math.min(position.line, lines.length - 1);
		const character = position.line >= lines.length ? lines[line].length
			: Math.min(position.character, lines[line].length);
		return new vscode.Position(line, character);
	});
	const document = {
		uri: { toString: () => 'file:///workspace/a.md' }, version: 7,
		getText: () => text, validatePosition,
	} as unknown as vscode.TextDocument;
	const panel = {
		webview: {
			postMessage,
			onDidReceiveMessage: (listener: typeof receive) => {
				receive = listener;
				return { dispose: vi.fn() };
			},
			asWebviewUri: () => ({ toString: () => 'webview://workspace' }),
		},
	} as unknown as vscode.WebviewPanel;
	const openMarkdownFragment = vi.fn<(uri: vscode.Uri, fragment: string) => Promise<void>>().mockResolvedValue(undefined);
	const session = new DocumentSyncSession(document, panel, () => 'body { color: red; }', openMarkdownFragment);
	sessions.push(session);
	return { session, postMessage, validatePosition, document, openMarkdownFragment,
		ready: () => receive({ type: 'ready' }),
		openLink: (href: string) => receive({ type: 'openLink', href }),
		receive: (message: EditorToHostMessage) => receive(message),
	};
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); });

describe('DocumentSyncSession location delivery', () => {
	it('sends an initial pending jump after init when the webview becomes ready', async () => {
		const { session, postMessage, ready, document } = createSession();
		session.jumpToLocation(2, 4);
		expect(postMessage).not.toHaveBeenCalled();
		ready();
		expect(postMessage).toHaveBeenNthCalledWith(1, {
			type: 'init', text: document.getText(), version: 7,
			css: 'body { color: red; }', codeTheme: 'dark-plus', baseUri: 'webview://workspace/', gitBase: null,
		});
		expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'jumpToLine', line: 2, column: 4 });
		await Promise.resolve();
		expect(tokenizeDocument).toHaveBeenCalledExactlyOnceWith(document);
		expect(postMessage).toHaveBeenNthCalledWith(3, { type: 'codeTokens', blocks: [] });
	});

	it('keeps only the last pending request before ready', () => {
		const { session, postMessage, ready } = createSession();
		session.jumpToLocation(1, 2);
		session.jumpToLocation(2, 5);
		session.jumpToLocation(3, 3);
		ready();
		const jumps = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === 'jumpToLine');
		expect(jumps).toEqual([{ type: 'jumpToLine', line: 3, column: 3 }]);
	});

	it('sends subsequent requests immediately for an existing ready session', () => {
		const { session, postMessage, ready } = createSession();
		ready();
		postMessage.mockClear();
		session.jumpToLocation(2, 3);
		expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'jumpToLine', line: 2, column: 3 });
		session.jumpToLocation(1, 5);
		expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'jumpToLine', line: 1, column: 5 });
	});

	it('does not invent or replay a pending jump on ready', () => {
		const { session, postMessage, ready } = createSession();
		ready();
		expect(postMessage.mock.calls.some(([message]) => message.type === 'jumpToLine')).toBe(false);
		session.jumpToLocation(2, 3);
		postMessage.mockClear();
		ready();
		expect(postMessage.mock.calls.some(([message]) => message.type === 'jumpToLine')).toBe(false);
	});

	it.each([
		['first\n📚 notes\nlast', 2, 999, 2, 9],
		['first\n📚 notes\nlast', 999, 1, 3, 5],
		['first\n📚 notes\nlast', 999, 999, 3, 5],
		['', 8, 9, 1, 1],
		['first\n', 2, 9, 2, 1],
	] as const)('clamps positions in %j at line %i, column %i through document validation', (text, line, column, expectedLine, expectedColumn) => {
		const { session, postMessage, validatePosition, ready } = createSession(text);
		session.jumpToLocation(line, column);
		expect(validatePosition).not.toHaveBeenCalled();
		ready();
		expect(validatePosition).toHaveBeenCalledExactlyOnceWith(new vscode.Position(line - 1, column - 1));
		expect(postMessage).toHaveBeenNthCalledWith(2, {
			type: 'jumpToLine', line: expectedLine, column: expectedColumn,
		});
	});

	it('preserves outline line-only navigation with column one', () => {
		const { session, postMessage, ready } = createSession();
		session.jumpToLocation(1, 4);
		session.jumpToLine(2);
		ready();
		expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'jumpToLine', line: 2, column: 1 });
	});
});


describe('DocumentSyncSession fragment navigation', () => {
	it('delivers a fragment after the destination has received init', () => {
		const { session, postMessage, ready } = createSession();
		session.jumpToFragment('#deliverable');
		expect(postMessage).not.toHaveBeenCalled();
		ready();
		expect(postMessage.mock.calls[0][0].type).toBe('init');
		expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'jumpToFragment', fragment: '#deliverable' });
	});

	it('delivers immediately to an existing ready destination', () => {
		const { session, postMessage, ready } = createSession();
		ready();
		postMessage.mockClear();
		session.jumpToFragment('#deliverable');
		expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'jumpToFragment', fragment: '#deliverable' });
	});

	it('uses the latest request when line and fragment navigation overlap', () => {
		const first = createSession();
		first.session.jumpToLocation(2, 3);
		first.session.jumpToFragment('#deliverable');
		first.ready();
		expect(first.postMessage.mock.calls[1][0]).toEqual({ type: 'jumpToFragment', fragment: '#deliverable' });
		const second = createSession();
		second.session.jumpToFragment('#deliverable');
		second.session.jumpToLocation(2, 3);
		second.ready();
		expect(second.postMessage.mock.calls[1][0]).toEqual({ type: 'jumpToLine', line: 2, column: 3 });
	});

	it.each(['destination.md', 'destination.MD', 'destination.markdown'])('opens %s with its fragment', async (filename) => {
		const { openLink, openMarkdownFragment, document } = createSession();
		const directory = { path: '/workspace', toString: () => 'file:///workspace' } as vscode.Uri;
		const destination = { path: `/workspace/${filename}`, toString: () => `file:///workspace/${filename}` } as vscode.Uri;
		vi.mocked(vscode.Uri.joinPath).mockReturnValueOnce(directory).mockReturnValueOnce(destination);
		openLink(`${filename}#deliverable`);
		await vi.waitFor(() => expect(openMarkdownFragment).toHaveBeenCalledExactlyOnceWith(destination, '#deliverable'));
		expect(vscode.Uri.joinPath).toHaveBeenCalledWith(document.uri, '..');
		expect(vscode.Uri.joinPath).toHaveBeenCalledWith(directory, filename);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('keeps ordinary file links on the existing open path', async () => {
		const { openLink, openMarkdownFragment } = createSession();
		const destination = { path: '/workspace/destination.md', toString: () => 'file:///workspace/destination.md' } as vscode.Uri;
		vi.mocked(vscode.Uri.joinPath).mockReturnValueOnce(destination).mockReturnValueOnce(destination);
		openLink('destination.md');
		await vi.waitFor(() => expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', destination));
		expect(openMarkdownFragment).not.toHaveBeenCalled();
	});

	it('reports a missing destination without attempting a fragment jump', async () => {
		const { openLink, openMarkdownFragment } = createSession();
		vi.mocked(vscode.workspace.fs.stat).mockRejectedValueOnce(new Error('Not found'));
		openLink('missing.md#deliverable');
		await vi.waitFor(() => expect(vscode.window.showWarningMessage).toHaveBeenCalled());
		expect(openMarkdownFragment).not.toHaveBeenCalled();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});
});


it('reports a preview-open failure instead of opening the Markdown file externally', async () => {
	const { openLink, openMarkdownFragment } = createSession();
	const destination = { path: '/workspace/destination.md', toString: () => 'file:///workspace/destination.md' } as vscode.Uri;
	vi.mocked(vscode.Uri.joinPath).mockReturnValueOnce(destination).mockReturnValueOnce(destination);
	openMarkdownFragment.mockRejectedValueOnce(new Error('Preview failed'));
	openLink('destination.md#deliverable');
	await vi.waitFor(() => expect(vscode.window.showWarningMessage).toHaveBeenCalled());
	expect(vscode.env.openExternal).not.toHaveBeenCalled();
});


describe('DocumentSyncSession selection capture', () => {
	it('restores source selection before answering a capture queued during initial load', async () => {
		const { session, ready, receive, postMessage } = createSession();
		const selection = { anchor: 12, head: 7 };
		session.restoreSelection(selection);
		const captured = session.captureSelection();
		expect(postMessage).not.toHaveBeenCalled();
		ready();
		await Promise.resolve();
		expect(postMessage.mock.calls.slice(0, 3).map(([message]) => message.type)).toEqual([
			'init', 'restoreSelection', 'requestSelection',
		]);
		const request = postMessage.mock.calls[2][0];
		if (request.type !== 'requestSelection') throw new Error('Expected capture request');
		receive({ type: 'selection', requestId: request.requestId, selection });
		await expect(captured).resolves.toEqual(selection);
	});

	it('waits for flushed edits before interpreting the captured offsets', async () => {
		const { session, ready, receive, postMessage, document } = createSession();
		ready();
		let release!: () => void;
		const edit = new Promise<void>((resolve) => { release = resolve; });
		vi.spyOn(session as unknown as { applyEdit: () => Promise<void> }, 'applyEdit').mockReturnValueOnce(edit);
		const captured = session.captureSelection();
		await Promise.resolve();
		const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
		if (request.type !== 'requestSelection') throw new Error('Expected capture request');
		receive({ type: 'edit', baseVersion: 7, changes: [{ from: 0, to: 0, insert: 'new text' }] });
		receive({ type: 'selection', requestId: request.requestId, selection: { anchor: 22, head: 22 } });
		let resolved = false;
		void captured.then(() => { resolved = true; });
		await Promise.resolve();
		expect(resolved).toBe(false);
		vi.spyOn(document, 'getText').mockReturnValue('new text first\n📚 notes\nlast');
		release();
		await expect(captured).resolves.toEqual({ anchor: 22, head: 22 });
	});

	it('waits for already queued edits before requesting the view selection', async () => {
		const { session, ready, receive, postMessage } = createSession();
		ready();
		postMessage.mockClear();
		let release!: () => void;
		const edit = new Promise<void>((resolve) => { release = resolve; });
		vi.spyOn(session as unknown as { applyEdit: () => Promise<void> }, 'applyEdit').mockReturnValueOnce(edit);
		receive({ type: 'edit', baseVersion: 7, changes: [] });
		const captured = session.captureSelection();
		await Promise.resolve();
		expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'requestSelection' }));
		release();
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'requestSelection' })));
		const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
		if (request.type !== 'requestSelection') throw new Error('Expected capture request');
		receive({ type: 'selection', requestId: request.requestId, selection: { anchor: 3, head: 1 } });
		await expect(captured).resolves.toEqual({ anchor: 3, head: 1 });
	});

	it('ignores unrelated responses and clamps offsets to the updated document', async () => {
		const { session, ready, receive, postMessage, document } = createSession();
		ready();
		const captured = session.captureSelection();
		await Promise.resolve();
		const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
		if (request.type !== 'requestSelection') throw new Error('Expected capture request');
		receive({ type: 'selection', requestId: request.requestId + 1, selection: { anchor: 1, head: 1 } });
		receive({ type: 'selection', requestId: request.requestId, selection: { anchor: 999, head: -1 } });
		await expect(captured).resolves.toEqual({ anchor: document.getText().length, head: 0 });
	});

	it('rejects malformed positions rather than silently switching to an arbitrary cursor', async () => {
		const { session, ready, receive, postMessage } = createSession();
		ready();
		const captured = session.captureSelection();
		await Promise.resolve();
		const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
		if (request.type !== 'requestSelection') throw new Error('Expected capture request');
		receive({ type: 'selection', requestId: request.requestId, selection: { anchor: NaN, head: 0 } });
		await expect(captured).rejects.toThrow('invalid cursor position');
	});

	it('rejects pending requests when the preview closes', async () => {
		const { session } = createSession();
		const captured = session.captureSelection();
		session.dispose();
		await expect(captured).rejects.toThrow('closed');
		await expect(session.captureSelection()).rejects.toThrow('closed');
	});

	it('bounds the wait for a preview that never becomes ready', async () => {
		vi.useFakeTimers();
		try {
			const { session } = createSession();
			const captured = session.captureSelection();
			const rejected = expect(captured).rejects.toThrow('did not respond');
			await vi.advanceTimersByTimeAsync(10_000);
			await rejected;
		} finally { vi.useRealTimers(); }
	});
});


it('rejects an old snapshot when flushed edits require a document resync', async () => {
	const { session, ready, receive, postMessage } = createSession();
	ready();
	const captured = session.captureSelection();
	const rejected = expect(captured).rejects.toThrow('changed while capturing');
	await Promise.resolve();
	const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
	if (request.type !== 'requestSelection') throw new Error('Expected capture request');
	receive({ type: 'edit', baseVersion: 6, changes: [{ from: 0, to: 0, insert: 'stale' }] });
	receive({ type: 'selection', requestId: request.requestId, selection: { anchor: 3, head: 3 } });
	await rejected;
});

it('does not bypass pending edits when a queued capture becomes ready', async () => {
	const { session, ready, receive, postMessage } = createSession();
	let release!: () => void;
	const edit = new Promise<void>((resolve) => { release = resolve; });
	vi.spyOn(session as unknown as { applyEdit: () => Promise<void> }, 'applyEdit').mockReturnValueOnce(edit);
	receive({ type: 'edit', baseVersion: 7, changes: [] });
	const captured = session.captureSelection();
	ready();
	await Promise.resolve();
	expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'requestSelection' }));
	release();
	await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'requestSelection' })));
	const request = postMessage.mock.calls.map(([message]) => message).find(message => message.type === 'requestSelection')!;
	if (request.type !== 'requestSelection') throw new Error('Expected capture request');
	receive({ type: 'selection', requestId: request.requestId, selection: { anchor: 3, head: 3 } });
	await expect(captured).resolves.toEqual({ anchor: 3, head: 3 });
});
