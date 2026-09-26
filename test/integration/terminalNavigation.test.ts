import * as assert from 'assert';
import * as vscode from 'vscode';

suite('terminal location navigation', () => {
	let file: vscode.Uri;
	let originalMode: string | undefined;
	const config = () => vscode.workspace.getConfiguration('mdLivePreview');

	suiteSetup(async () => {
		await vscode.extensions.getExtension('t-shoot.markdown-live-preview-editor')!.activate();
		originalMode = config().get('defaultEditor');
		await config().update('defaultEditor', 'prompt', vscode.ConfigurationTarget.Global);
		file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'terminal-location.md');
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(
			Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join('\n')));
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.workspace.fs.delete(file);
		await config().update('defaultEditor', originalMode, vscode.ConfigurationTarget.Global);
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('accepts a location while a new preview is opening', async () => {
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 90, 4);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), file.toString());
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	test('reuses the existing preview for another location', async () => {
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 90, 4);
		const group = vscode.window.tabGroups.activeTabGroup;
		const count = group.tabs.length;
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 3, 1);
		assert.strictEqual(group.tabs.length, count);
		const input = group.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), file.toString());
	});

	test('replaces an active source tab without creating a duplicate', async () => {
		await vscode.window.showTextDocument(file, { preview: false });
		const group = vscode.window.tabGroups.activeTabGroup;
		const count = group.tabs.length;
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 20, 2);
		assert.strictEqual(group.tabs.length, count);
		assert.ok(group.activeTab?.input instanceof vscode.TabInputCustom);
	});

	test('uses the existing document identity for alternate filename casing', async function () {
		const alternate = file.with({ path: file.path.replace('terminal-location.md', 'TERMINAL-LOCATION.md') });
		try {
			await vscode.workspace.fs.stat(alternate);
		} catch {
			this.skip(); // A case-sensitive filesystem correctly treats this as another path.
		}
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 20, 1);
		const group = vscode.window.tabGroups.activeTabGroup;
		const count = group.tabs.length;
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', alternate, 30, 1);
		assert.strictEqual(group.tabs.length, count);
		const input = group.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), file.toString());
	});

	test('rejects invalid coordinates before opening an editor', async () => {
		await assert.rejects(async () => {
			await vscode.commands.executeCommand('mdLivePreview.openAtLocation', file, 0, 1);
		});
		assert.ok(!vscode.window.tabGroups.activeTabGroup.activeTab);
	});
});
