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
	workspace: { onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })) },
	window: { onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })) },
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
	const session = new DocumentSyncSession(document, panel, () => 'body { color: red; }');
	sessions.push(session);
	return { session, postMessage, validatePosition, document, ready: () => receive({ type: 'ready' }) };
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
			css: 'body { color: red; }', codeTheme: 'dark-plus', baseUri: 'webview://workspace/',
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
