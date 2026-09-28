import * as assert from 'assert';
import * as vscode from 'vscode';

/** Wait for asynchronous editor replacement or configuration propagation. */
async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Editor state did not settle');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** Read the resource represented by either supported tab input. */
function tabUri(tab: vscode.Tab): string | undefined {
	const input = tab.input;
	return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
		? input.uri.toString() : undefined;
}

suite('in-place editor switching', () => {
	let files: vscode.Uri[];
	let originalMode: string | undefined;
	const config = () => vscode.workspace.getConfiguration('mdLivePreview');

	suiteSetup(async () => {
		await vscode.extensions.getExtension('t-shoot.markdown-live-preview-editor')!.activate();
		originalMode = config().get('defaultEditor');
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder);
		files = ['switch-left.txt', 'switch-sample.md', 'switch-right.txt']
			.map((name) => vscode.Uri.joinPath(folder.uri, name));
		for (const file of files) {
			await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('# Heading\n\nBody.\n'));
		}
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await config().update('defaultEditor', originalMode, vscode.ConfigurationTarget.Global);
		for (const file of files) await vscode.workspace.fs.delete(file);
	});

	setup(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await config().update('defaultEditor', 'prompt', vscode.ConfigurationTarget.Global);
		await waitFor(() => !vscode.workspace.getConfiguration()
			.get<Record<string, string>>('workbench.editorAssociations')?.['*.md']);
		for (const file of files) await vscode.window.showTextDocument(file, { preview: false });
		await vscode.window.showTextDocument(files[1], { preview: false });
	});

	test('round trips in the original tab without moving adjacent tabs', async () => {
		const group = vscode.window.tabGroups.activeTabGroup;
		const initialOrder = group.tabs.map(tabUri);
		const index = group.tabs.indexOf(group.activeTab!);
		assert.strictEqual(initialOrder.length, 3);

		for (let attempt = 0; attempt < 2; attempt++) {
			await vscode.commands.executeCommand('mdLivePreview.openWithLivePreview');
			await waitFor(() => group.activeTab?.input instanceof vscode.TabInputCustom);
			assert.strictEqual((group.activeTab!.input as vscode.TabInputCustom).viewType, 'mdLivePreview.editor');
			assert.deepStrictEqual(group.tabs.map(tabUri), initialOrder);
			assert.strictEqual(group.tabs.indexOf(group.activeTab!), index);
			await vscode.commands.executeCommand('mdLivePreview.openWithSource');
			await waitFor(() => group.activeTab?.input instanceof vscode.TabInputText);
			assert.deepStrictEqual(group.tabs.map(tabUri), initialOrder);
			assert.strictEqual(group.tabs.indexOf(group.activeTab!), index);
		}
	});

	for (const reversed of [false, true]) {
		test(`source round trip preserves ${reversed ? 'reversed primary selection' : 'cursor position'} with Unicode`, async () => {
			const source = vscode.window.activeTextEditor!;
			const originalText = source.document.getText();
			const text = '# 日本語 😀 heading\n\nBefore 🦊 café é after.\nLast line.\n';
			try {
				await source.edit((edit) => edit.replace(
					new vscode.Range(source.document.positionAt(0), source.document.positionAt(originalText.length)), text,
				));
				const head = text.indexOf('café');
				const anchor = reversed ? text.indexOf('Last') + 4 : head;
				source.selections = [
					new vscode.Selection(source.document.positionAt(anchor), source.document.positionAt(head)),
					new vscode.Selection(0, 2, 0, 2),
				];
				const expectedReversed = source.selection.isReversed;
				await vscode.commands.executeCommand('mdLivePreview.openWithLivePreview');
				await vscode.commands.executeCommand('mdLivePreview.openWithSource');
				const restored = vscode.window.activeTextEditor!;
				assert.strictEqual(restored.document.uri.toString(), files[1].toString());
				assert.strictEqual(restored.document.offsetAt(restored.selection.anchor), anchor);
				assert.strictEqual(restored.document.offsetAt(restored.selection.active), head);
				assert.strictEqual(restored.selection.isReversed, expectedReversed);
			} finally {
				const document = await vscode.workspace.openTextDocument(files[1]);
				const edit = new vscode.WorkspaceEdit();
				edit.replace(files[1], new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), originalText);
				await vscode.workspace.applyEdit(edit);
				await document.save();
			}
		});
	}

	test('switching to source preserves the preview cursor location', async () => {
		const source = vscode.window.activeTextEditor!;
		source.selection = new vscode.Selection(0, 1, 0, 1);
		await vscode.commands.executeCommand('mdLivePreview.openAtLocation', files[1], 3, 4);
		await vscode.commands.executeCommand('mdLivePreview.openWithSource');
		await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === files[1].toString());
		assert.strictEqual(vscode.window.activeTextEditor!.selection.active.line, 2);
		assert.strictEqual(vscode.window.activeTextEditor!.selection.active.character, 3);
	});

	test('repeated toggle commands do not race selection capture or create tabs', async () => {
		const source = vscode.window.activeTextEditor!;
		source.selection = new vscode.Selection(2, 3, 2, 3);
		const group = vscode.window.tabGroups.activeTabGroup;
		const order = group.tabs.map(tabUri);
		await Promise.all([
			vscode.commands.executeCommand('mdLivePreview.openWithLivePreview'),
			vscode.commands.executeCommand('mdLivePreview.openWithLivePreview'),
		]);
		await Promise.all([
			vscode.commands.executeCommand('mdLivePreview.openWithSource'),
			vscode.commands.executeCommand('mdLivePreview.openWithSource'),
		]);
		assert.deepStrictEqual(group.tabs.map(tabUri), order);
		assert.strictEqual(vscode.window.activeTextEditor!.selection.active.line, 2);
		assert.strictEqual(vscode.window.activeTextEditor!.selection.active.character, 3);
	});

	test('an explicit source choice is not reopened by livePreview mode', async () => {
		await vscode.commands.executeCommand('mdLivePreview.openWithLivePreview');
		await config().update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
		await waitFor(() => vscode.workspace.getConfiguration()
			.get<Record<string, string>>('workbench.editorAssociations')?.['*.md'] === 'mdLivePreview.editor');
		await vscode.commands.executeCommand('mdLivePreview.openWithSource');
		// Cover the complete retry schedule used by the auto-reopen watcher.
		await new Promise((resolve) => setTimeout(resolve, 2500));
		const group = vscode.window.tabGroups.activeTabGroup;
		assert.ok(group.activeTab?.input instanceof vscode.TabInputText);
		assert.strictEqual(tabUri(group.activeTab!), files[1].toString());
		assert.strictEqual(group.tabs.length, 3);
	});

	test('switching retains edited Markdown', async () => {
		const editor = vscode.window.activeTextEditor!;
		await editor.edit((edit) => edit.insert(new vscode.Position(2, 0), 'Unsaved '));
		const text = editor.document.getText();
		try {
			await vscode.commands.executeCommand('mdLivePreview.openWithLivePreview');
			await vscode.commands.executeCommand('mdLivePreview.openWithSource');
			assert.strictEqual(vscode.window.activeTextEditor?.document.getText(), text);
		} finally {
			await editor.document.save();
		}
	});
});
