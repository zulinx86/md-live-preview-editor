import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DocumentSyncSession } from './documentSync';
import { MarkdownLivePreviewProvider } from './MarkdownLivePreviewProvider';

vi.mock('vscode', () => ({
	Uri: {
		parse: (value: string) => ({ toString: () => value }),
		joinPath: (base: vscode.Uri, ...parts: string[]) => ({
			toString: () => `${base.toString()}/${parts.join('/')}`,
		}),
	},
	TabInputText: class { constructor(public uri: vscode.Uri) {} },
	TabInputCustom: class { constructor(public uri: vscode.Uri, public viewType: string) {} },
	window: {
		registerCustomEditorProvider: vi.fn(() => ({ dispose: vi.fn() })),
		tabGroups: { activeTabGroup: { viewColumn: 2, activeTab: undefined } },
	},
	workspace: { openTextDocument: vi.fn() },
	commands: { executeCommand: vi.fn() },
	env: { language: 'en' },
}));

vi.mock('./documentSync', () => ({
	DocumentSyncSession: vi.fn(function (document: vscode.TextDocument, panel: vscode.WebviewPanel) {
		return {
			getDocument: () => document,
			getViewColumn: () => panel.viewColumn,
			jumpToFragment: vi.fn(),
			jumpToLocation: vi.fn(),
			dispose: vi.fn(),
		};
	}),
}));

const target = vscode.Uri.parse('file:///workspace/doing/decide-flights.md');
const source = vscode.Uri.parse('file:///workspace/todo/plan.md');
const executeCommand = vi.mocked(vscode.commands.executeCommand);
const openTextDocument = vi.mocked(vscode.workspace.openTextDocument);
let provider: MarkdownLivePreviewProvider;
const getCss = () => '';

function document(uri: vscode.Uri): vscode.TextDocument {
	return { uri } as vscode.TextDocument;
}

function setActive(input?: vscode.TabInputText | vscode.TabInputCustom): void {
	Object.assign(vscode.window.tabGroups.activeTabGroup, {
		viewColumn: 2, activeTab: input ? { input } : undefined,
	});
}

function resolvePreview(uri = target, viewColumn = 2) {
	const onDidDispose = vi.fn();
	const panel = {
		viewColumn,
		webview: { asWebviewUri: (uri: vscode.Uri) => uri, cspSource: 'test' },
		onDidDispose,
	} as unknown as vscode.WebviewPanel;
	const doc = document(uri);
	provider.resolveCustomTextEditor(doc, panel);
	const session = vi.mocked(DocumentSyncSession).mock.results.at(-1)!.value as DocumentSyncSession;
	return { session, doc, panel, onDidDispose };
}

beforeEach(() => {
	vi.clearAllMocks();
	executeCommand.mockReset().mockResolvedValue(undefined);
	openTextDocument.mockReset().mockImplementation(async () => document(target));
	setActive();
	provider = MarkdownLivePreviewProvider.register(
		{ extensionUri: vscode.Uri.parse('file:///extension') } as vscode.ExtensionContext,
		getCss,
	).provider;
});

describe('MarkdownLivePreviewProvider fragment navigation', () => {
	it('wires each session callback to openAtFragment and returns its promise', async () => {
		const { doc, panel } = resolvePreview(source);
		const open = vi.spyOn(provider, 'openAtFragment').mockResolvedValue(undefined);
		expect(DocumentSyncSession).toHaveBeenCalledWith(doc, panel, getCss, expect.any(Function));
		const callback = vi.mocked(DocumentSyncSession).mock.calls[0][3];
		const result = callback(target, 'deliverable');
		expect(result).toBe(open.mock.results[0].value);
		await result;
		expect(open).toHaveBeenCalledExactlyOnceWith(target, 'deliverable');
	});

	it('opens a new preview in the active group before delivering the fragment', async () => {
		setActive(new vscode.TabInputCustom(source, MarkdownLivePreviewProvider.viewType));
		const origin = resolvePreview(source).session;
		let destination!: DocumentSyncSession;
		executeCommand.mockImplementation(async () => {
			destination = resolvePreview().session;
		});
		await provider.openAtFragment(target, 'deliverable');
		expect(openTextDocument).toHaveBeenCalledExactlyOnceWith(target);
		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
			'vscode.openWith', target, MarkdownLivePreviewProvider.viewType,
			{ viewColumn: 2, preview: false, preserveFocus: false },
		);
		expect(destination.jumpToFragment).toHaveBeenCalledExactlyOnceWith('deliverable');
		expect(origin.jumpToFragment).not.toHaveBeenCalled();
	});

	it('targets the existing preview in the active group, not another group or document', async () => {
		const otherGroup = resolvePreview(target, 1).session;
		const otherDocument = resolvePreview(source).session;
		const destination = resolvePreview().session;
		setActive(new vscode.TabInputCustom(target, MarkdownLivePreviewProvider.viewType));
		await provider.openAtFragment(target, 'deliverable');
		expect(executeCommand).toHaveBeenCalledWith(
			'vscode.openWith', target, MarkdownLivePreviewProvider.viewType, expect.objectContaining({ viewColumn: 2 }),
		);
		expect(destination.jumpToFragment).toHaveBeenCalledExactlyOnceWith('deliverable');
		expect(otherGroup.jumpToFragment).not.toHaveBeenCalled();
		expect(otherDocument.jumpToFragment).not.toHaveBeenCalled();
		expect(DocumentSyncSession).toHaveBeenCalledTimes(3);
	});

	it('canonicalizes the URI before reopening the active source tab in place', async () => {
		const alias = vscode.Uri.parse('file:///workspace/doing/../doing/decide-flights.md');
		setActive(new vscode.TabInputText(target));
		let destination!: DocumentSyncSession;
		executeCommand.mockImplementation(async () => { destination = resolvePreview().session; });
		await provider.openAtFragment(alias, 'delivery%20details');
		expect(openTextDocument).toHaveBeenCalledExactlyOnceWith(alias);
		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
			'reopenActiveEditorWith', MarkdownLivePreviewProvider.viewType,
		);
		expect(destination.jumpToFragment).toHaveBeenCalledExactlyOnceWith('delivery%20details');
	});

	it('uses the canonical URI for opening and session lookup', async () => {
		const alias = vscode.Uri.parse('file:///workspace/doing/../doing/decide-flights.md');
		setActive(new vscode.TabInputText(source));
		const destination = resolvePreview().session;
		await provider.openAtFragment(alias, 'deliverable');
		expect(executeCommand).toHaveBeenCalledWith(
			'vscode.openWith', target, MarkdownLivePreviewProvider.viewType, expect.any(Object),
		);
		expect(destination.jumpToFragment).toHaveBeenCalledExactlyOnceWith('deliverable');
	});

	it('rejects when only a session in another group exists', async () => {
		const destination = resolvePreview(target, 1).session;
		await expect(provider.openAtFragment(target, 'deliverable')).rejects.toThrow(
			'The Markdown preview session could not be opened',
		);
		expect(destination.jumpToFragment).not.toHaveBeenCalled();
	});

	it('does not target a disposed session', async () => {
		const { session, onDidDispose } = resolvePreview();
		onDidDispose.mock.calls[0][0]();
		await expect(provider.openAtFragment(target, 'deliverable')).rejects.toThrow(
			'The Markdown preview session could not be opened',
		);
		expect(session.dispose).toHaveBeenCalledOnce();
		expect(session.jumpToFragment).not.toHaveBeenCalled();
	});

	it('propagates document-open failures without opening a preview', async () => {
		const error = new Error('File not found');
		openTextDocument.mockRejectedValueOnce(error);
		await expect(provider.openAtFragment(target, 'deliverable')).rejects.toBe(error);
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('propagates preview-open failures without delivering a fragment', async () => {
		const destination = resolvePreview().session;
		const error = new Error('Unable to open editor');
		executeCommand.mockRejectedValueOnce(error);
		await expect(provider.openAtFragment(target, 'deliverable')).rejects.toBe(error);
		expect(destination.jumpToFragment).not.toHaveBeenCalled();
	});
});

describe('MarkdownLivePreviewProvider location navigation', () => {
	it.each([[0, 1], [1, 0], [-1, 1], [1, 1.5], [NaN, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER + 1, 1]])(
		'rejects invalid location %s:%s before opening the preview', async (line, column) => {
			await expect(provider.openAtLocation(target, line, column)).rejects.toThrow(
				'Markdown locations require positive integer line and column numbers',
			);
			expect(executeCommand).not.toHaveBeenCalled();
			expect(openTextDocument).not.toHaveBeenCalled();
		},
	);

	it('reopens the source tab in place and preserves explicit coordinates', async () => {
		setActive(new vscode.TabInputText(target));
		const destination = resolvePreview().session;
		await provider.openAtLocation(target, 12, 4);
		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
			'reopenActiveEditorWith', MarkdownLivePreviewProvider.viewType,
		);
		expect(destination.jumpToLocation).toHaveBeenCalledExactlyOnceWith(12, 4);
		expect(openTextDocument).not.toHaveBeenCalled();
	});

	it('opens in the active group with the default column and delegates clamping', async () => {
		let destination!: DocumentSyncSession;
		executeCommand.mockImplementation(async () => { destination = resolvePreview().session; });
		await provider.openAtLocation(target, 999);
		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
			'vscode.openWith', target, MarkdownLivePreviewProvider.viewType,
			{ viewColumn: 2, preview: false, preserveFocus: false },
		);
		expect(destination.jumpToLocation).toHaveBeenCalledExactlyOnceWith(999, 1);
	});
});
