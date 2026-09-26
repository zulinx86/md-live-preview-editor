import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { MarkdownTerminalLinkProvider } from './MarkdownTerminalLinkProvider';

vi.mock('vscode', async () => {
	const { pathToFileURL, fileURLToPath } = await import('node:url');
	const { posix } = await import('node:path');
	// Model only URI operations used by the provider, preserving URI authority.
	function uri(url: URL): vscode.Uri {
		return {
			scheme: url.protocol.slice(0, -1), authority: url.host,
			path: decodeURIComponent(url.pathname),
			fsPath: url.protocol === 'file:' ? fileURLToPath(url) : decodeURIComponent(url.pathname),
			toString: () => url.toString(),
		} as vscode.Uri;
	}
	return {
		Uri: {
			file: (path: string) => uri(pathToFileURL(path)),
			parse: (value: string) => uri(new URL(value)),
			joinPath: (base: vscode.Uri, ...parts: string[]) => {
				const url = new URL(base.toString());
				url.pathname = posix.join(base.path, ...parts);
				return uri(url);
			},
		},
		FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
		workspace: {
			getConfiguration: vi.fn(), fs: { stat: vi.fn() },
			workspaceFolders: [{ uri: uri(new URL('file:///workspace')), name: 'workspace', index: 0 }],
		},
		window: { showWarningMessage: vi.fn() },
		l10n: { t: (message: string) => message },
	};
});

function context(line: string, cwd?: vscode.Uri): vscode.TerminalLinkContext {
	return { line, terminal: { shellIntegration: cwd ? { cwd } : undefined } } as vscode.TerminalLinkContext;
}

function cancellation(): vscode.CancellationToken {
	return { isCancellationRequested: false, onCancellationRequested: vi.fn() };
}

const stat = vi.mocked(vscode.workspace.fs.stat);
const openLocation = vi.fn<(uri: vscode.Uri, line: number, column: number) => Promise<void>>();
let provider: MarkdownTerminalLinkProvider;

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
		get: vi.fn().mockReturnValue('livePreview'),
	} as unknown as vscode.WorkspaceConfiguration);
	stat.mockResolvedValue({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 });
	openLocation.mockResolvedValue(undefined);
	provider = new MarkdownTerminalLinkProvider(openLocation);
});

describe('MarkdownTerminalLinkProvider', () => {
	it.each(['prompt', 'default'])('does not stat links when defaultEditor is %s', async (mode) => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(mode),
		} as unknown as vscode.WorkspaceConfiguration);
		expect(await provider.provideTerminalLinks(context('/tmp/a.md:2'), cancellation())).toEqual([]);
		expect(stat).not.toHaveBeenCalled();
	});

	it('does not stat an already cancelled request', async () => {
		const token = { ...cancellation(), isCancellationRequested: true };
		expect(await provider.provideTerminalLinks(context('/tmp/a.md:2'), token)).toEqual([]);
		expect(stat).not.toHaveBeenCalled();
	});

	it('discards links cancelled while stat is pending', async () => {
		let finishStat!: (value: vscode.FileStat) => void;
		stat.mockReturnValue(new Promise((resolve) => { finishStat = resolve; }));
		const token = { ...cancellation() };
		const result = provider.provideTerminalLinks(context('/tmp/a.md:2'), token);
		expect(stat).toHaveBeenCalledOnce();
		token.isCancellationRequested = true;
		finishStat({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 10 });
		expect(await result).toEqual([]);
	});

	it.each([
		['/tmp/a.md:2:3', '/tmp/a.md'],
		['file:///tmp/my%20notes.md:2:3', '/tmp/my notes.md'],
		['~/notes/a.md:2:3', join(homedir(), 'notes/a.md')],
	])('resolves %s without a cwd', async (text, expectedPath) => {
		const links = await provider.provideTerminalLinks(context(text), cancellation());
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({ startIndex: 0, length: text.length, line: 2, column: 3 });
		expect(links[0].uri.fsPath).toBe(expectedPath);
		expect(stat).toHaveBeenCalledExactlyOnceWith(links[0].uri);
	});

	it.each(['a.md', './a.md', '../current/a.md'])('resolves %s against the current shell cwd', async (path) => {
		const links = await provider.provideTerminalLinks(
			context(`${path}:7`, vscode.Uri.file('/workspace/current')), cancellation(),
		);
		expect(links).toHaveLength(1);
		expect(links[0].uri.fsPath).toBe('/workspace/current/a.md');
		expect(links[0].column).toBe(1);
	});

	it('preserves the remote cwd scheme and authority', async () => {
		const links = await provider.provideTerminalLinks(
			context('docs/a.md:7', vscode.Uri.parse('vscode-remote://ssh-remote+dev/workspace')), cancellation(),
		);
		expect(links[0].uri.toString()).toBe('vscode-remote://ssh-remote+dev/workspace/docs/a.md');
	});

	it('does not guess from terminal creation options or workspace folders when shell cwd is absent', async () => {
		const request = {
			line: 'a.md:2 ../a.md:3',
			terminal: { creationOptions: { cwd: '/initial' } },
		} as vscode.TerminalLinkContext;
		expect(await provider.provideTerminalLinks(request, cancellation())).toEqual([]);
		expect(stat).not.toHaveBeenCalled();
	});

	it('keeps existing files and file symlinks, excluding missing paths and directories', async () => {
		stat.mockImplementation(async (uri) => {
			if (uri.path.endsWith('/missing.md')) throw new Error('not found');
			const type = uri.path.endsWith('/directory.md') ? vscode.FileType.Directory
				: uri.path.endsWith('/symlink.md') ? vscode.FileType.File | vscode.FileType.SymbolicLink
					: vscode.FileType.File;
			return { type, ctime: 0, mtime: 0, size: 10 };
		});
		const links = await provider.provideTerminalLinks(
			context('/missing.md:1 /directory.md:2 /file.md:3 /symlink.md:4'), cancellation(),
		);
		expect(links.map((link) => link.uri.path)).toEqual(['/file.md', '/symlink.md']);
		expect(stat).toHaveBeenCalledTimes(4);
	});

	it('rechecks a clicked file before delivering its URI and one-based coordinates', async () => {
		const [link] = await provider.provideTerminalLinks(context('/tmp/a.md:12:4'), cancellation());
		stat.mockClear();
		expect(openLocation).not.toHaveBeenCalled();
		await provider.handleTerminalLink(link);
		expect(stat).toHaveBeenCalledExactlyOnceWith(link.uri);
		expect(openLocation).toHaveBeenCalledExactlyOnceWith(link.uri, 12, 4);
		expect(stat.mock.invocationCallOrder[0]).toBeLessThan(openLocation.mock.invocationCallOrder[0]);
	});

	it('does not open a file that disappeared after link detection', async () => {
		const [link] = await provider.provideTerminalLinks(context('/tmp/a.md:12'), cancellation());
		stat.mockRejectedValueOnce(new Error('not found'));
		await provider.handleTerminalLink(link);
		expect(openLocation).not.toHaveBeenCalled();
		expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
	});
});
