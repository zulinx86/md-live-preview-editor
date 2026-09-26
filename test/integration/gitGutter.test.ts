import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as ts from 'typescript';

type Tracker = new (uri: vscode.Uri, notify: (base: string | null) => void) => vscode.Disposable;
interface Repository {
	status(): Promise<void>;
}
interface API {
	openRepository(uri: vscode.Uri): Promise<Repository | null>;
}

/** Load the actual tracker in this test's VS Code API context, without exporting test hooks. */
async function loadTracker(): Promise<Tracker> {
	const extension = vscode.extensions.getExtension('t-shoot.markdown-live-preview-editor')!;
	const source = await fs.readFile(path.join(extension.extensionPath, 'src/editor/GitHeadTracker.ts'), 'utf8');
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const exports: { GitHeadTracker?: Tracker } = {};
	new Function('require', 'exports', compiled)(require, exports);
	return exports.GitHeadTracker!;
}

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 10000;
	while (!condition()) {
		if (Date.now() >= deadline) throw new Error('Git HEAD tracking did not settle');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

suite('Git gutter HEAD integration', () => {
	let api: API;
	let TrackerClass: Tracker;
	let directory: string;
	let repository: Repository;
	let trackers: vscode.Disposable[];

	function git(...args: string[]): void {
		execFileSync('git', args, {
			cwd: directory,
			env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
				GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
				GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
			stdio: 'pipe',
		});
	}

	suiteSetup(async () => {
		const gitExtension = vscode.extensions.getExtension<{ getAPI(version: 1): API }>('vscode.git');
		assert.ok(gitExtension, 'built-in Git extension is unavailable');
		api = (await gitExtension.activate()).getAPI(1);
		TrackerClass = await loadTracker();
	});

	setup(async () => {
		trackers = [];
		const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
		directory = await fs.mkdtemp(path.join(workspace, 'git-gutter-'));
		git('init', '--quiet');
		repository = (await api.openRepository(vscode.Uri.file(directory)))!;
		assert.ok(repository);
	});

	teardown(async () => {
		trackers.forEach((tracker) => tracker.dispose());
		await fs.rm(directory, { recursive: true, force: true });
	});

	test('reads HEAD, keeps the baseline after staging, and refreshes after commit', async () => {
		const file = path.join(directory, 'tracked.md');
		await fs.writeFile(file, 'original\n');
		git('add', 'tracked.md');
		git('commit', '--quiet', '--message', 'Baseline fixture');
		await repository.status();
		let base: string | null | undefined;
		trackers.push(new TrackerClass(vscode.Uri.file(file), (text) => { base = text; }));
		await waitFor(() => base === 'original\n');
		await fs.writeFile(file, 'changed\n');
		git('add', 'tracked.md');
		await repository.status();
		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.strictEqual(base, 'original\n');
		git('commit', '--quiet', '--message', 'Changed fixture');
		await repository.status();
		await waitFor(() => base === 'changed\n');
	});

	test('treats untracked files as new and excludes ignored files', async () => {
		await fs.writeFile(path.join(directory, '.gitignore'), 'ignored.md\n');
		await fs.writeFile(path.join(directory, 'new.md'), 'new file');
		await fs.writeFile(path.join(directory, 'ignored.md'), 'ignored file');
		await repository.status();
		let newBase: string | null | undefined;
		let ignoredBase: string | null | undefined;
		trackers.push(new TrackerClass(vscode.Uri.file(path.join(directory, 'new.md')), (text) => { newBase = text; }));
		trackers.push(new TrackerClass(vscode.Uri.file(path.join(directory, 'ignored.md')), (text) => { ignoredBase = text; }));
		await waitFor(() => newBase === '' && ignoredBase === null);
	});
});
