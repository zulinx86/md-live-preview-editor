import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { findMarkdownTerminalLinks } from '../shared/terminalFileLinks';

export interface MarkdownTerminalLink extends vscode.TerminalLink {
	uri: vscode.Uri;
	line: number;
	column: number;
}

/** Detect Markdown source locations before the standard opener loses their selection. */
export class MarkdownTerminalLinkProvider implements vscode.TerminalLinkProvider<MarkdownTerminalLink> {
	/**
	 * @param openLocation Opens a preview and delivers a one-based line/column.
	 */
	constructor(private readonly openLocation: (uri: vscode.Uri, line: number, column: number) => Thenable<void>) {}

	/**
	 * Find existing Markdown files referenced by a terminal line.
	 * @param context The unwrapped text and terminal producing it.
	 * @param token Cancellation for a stale terminal line.
	 * @returns Resolved links, or no links when preview is not the default editor.
	 */
	async provideTerminalLinks(context: vscode.TerminalLinkContext, token: vscode.CancellationToken): Promise<MarkdownTerminalLink[]> {
		if (token.isCancellationRequested || vscode.workspace.getConfiguration('mdLivePreview')
			.get<string>('defaultEditor', 'prompt') !== 'livePreview') return [];
		const cwd = context.terminal.shellIntegration?.cwd;
		const links = await Promise.all(findMarkdownTerminalLinks(context.line).map(async (location): Promise<MarkdownTerminalLink | undefined> => {
			if (token.isCancellationRequested) return undefined;
			try {
				const uri = this.resolvePath(location.path, cwd);
				if (!uri) return undefined;
				const stat = await vscode.workspace.fs.stat(uri);
				if (!(stat.type & vscode.FileType.File) || token.isCancellationRequested) return undefined;
				return {
					startIndex: location.startIndex, length: location.length,
					uri, line: location.line, column: location.column,
					tooltip: vscode.l10n.t('Open location in Markdown Live Preview'),
				};
			} catch {
				// Leave missing files and unsupported paths to VS Code's own providers.
				return undefined;
			}
		}));
		return links.filter((link): link is MarkdownTerminalLink => link !== undefined);
	}

	/**
	 * Open a clicked link without sending it through the default editor resolver.
	 * @param link A resolved terminal location.
	 * @returns Resolves after navigation, or after reporting a failed open.
	 */
	async handleTerminalLink(link: MarkdownTerminalLink): Promise<void> {
		try {
			await vscode.workspace.fs.stat(link.uri);
			await this.openLocation(link.uri, link.line, link.column);
		} catch (error) {
			void vscode.window.showWarningMessage(vscode.l10n.t(
				'Cannot open Markdown location: {0}', error instanceof Error ? error.message : String(error),
			));
		}
	}

	private resolvePath(path: string, cwd: vscode.Uri | undefined): vscode.Uri | undefined {
		if (path.startsWith('file://')) return vscode.Uri.parse(path);
		if (path.startsWith('~/')) return vscode.Uri.file(join(homedir(), path.slice(2)));
		if (isAbsolute(path)) return vscode.Uri.file(path);
		// Initial terminal options/workspace folders do not reflect subsequent cd commands.
		return cwd ? vscode.Uri.joinPath(cwd, path) : undefined;
	}
}
