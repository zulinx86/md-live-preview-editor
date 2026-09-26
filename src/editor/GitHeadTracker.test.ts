import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GitHeadTracker } from './GitHeadTracker';

vi.mock('vscode', () => ({ extensions: { getExtension: vi.fn() } }));

function event<T>() {
	const listeners = new Set<(value: T) => unknown>();
	const subscribe = vi.fn((listener: (value: T) => unknown) => {
		listeners.add(listener);
		return { dispose: vi.fn(() => { listeners.delete(listener); }) };
	});
	return { subscribe, fire: (value: T) => [...listeners].forEach((listener) => listener(value)), listeners };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function makeRepository(commit: string | undefined = 'commit-one') {
	const changed = event<void>();
	return {
		changed,
		state: { HEAD: { commit } as { commit?: string } | undefined, onDidChange: changed.subscribe },
		checkIgnore: vi.fn<(paths: string[]) => Promise<Set<string>>>().mockResolvedValue(new Set()),
		show: vi.fn<(ref: string, path: string) => Promise<string>>().mockResolvedValue('HEAD text'),
		getObjectDetails: vi.fn<(ref: string, path: string) => Promise<{ mode: string; object: string; size: number }>>()
			.mockResolvedValue({ mode: '100644', object: 'blob', size: 9 }),
	};
}

const uri = { fsPath: '/workspace/My Notes.md' } as vscode.Uri;
const trackers: GitHeadTracker[] = [];
let repository: ReturnType<typeof makeRepository>;
let opened: ReturnType<typeof event<ReturnType<typeof makeRepository>>>;
let closed: typeof opened;
let enablement: ReturnType<typeof event<boolean>>;
let api: {
	getRepository: ReturnType<typeof vi.fn<(uri: vscode.Uri) => ReturnType<typeof makeRepository> | null>>;
	onDidOpenRepository: typeof opened.subscribe;
	onDidCloseRepository: typeof closed.subscribe;
};
let git: { enabled: boolean; onDidChangeEnablement: typeof enablement.subscribe; getAPI: ReturnType<typeof vi.fn> };
let activate: ReturnType<typeof vi.fn>;

function start() {
	const onBase = vi.fn<(text: string | null) => void>();
	const tracker = new GitHeadTracker(uri, onBase);
	trackers.push(tracker);
	return { tracker, onBase };
}

async function flush() {
	await vi.advanceTimersByTimeAsync(150);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	repository = makeRepository();
	opened = event();
	closed = event();
	enablement = event();
	api = {
		getRepository: vi.fn().mockImplementation(() => repository),
		onDidOpenRepository: opened.subscribe,
		onDidCloseRepository: closed.subscribe,
	};
	git = { enabled: true, onDidChangeEnablement: enablement.subscribe, getAPI: vi.fn().mockReturnValue(api) };
	activate = vi.fn().mockResolvedValue(git);
	vi.mocked(vscode.extensions.getExtension).mockReturnValue({ activate } as unknown as vscode.Extension<unknown>);
});

afterEach(() => {
	trackers.splice(0).forEach((tracker) => tracker.dispose());
	vi.useRealTimers();
});

describe('GitHeadTracker', () => {
	it('activates Git API v1 and reads the initial HEAD with the original absolute path', async () => {
		const { onBase } = start();
		await flush();
		expect(vscode.extensions.getExtension).toHaveBeenCalledExactlyOnceWith('vscode.git');
		expect(activate).toHaveBeenCalledOnce();
		expect(git.getAPI).toHaveBeenCalledExactlyOnceWith(1);
		expect(api.getRepository).toHaveBeenCalledExactlyOnceWith(uri);
		expect(repository.checkIgnore).toHaveBeenCalledExactlyOnceWith([uri.fsPath]);
		expect(repository.show).toHaveBeenCalledExactlyOnceWith('commit-one', uri.fsPath);
		expect(repository.getObjectDetails).not.toHaveBeenCalled();
		expect(onBase).toHaveBeenCalledExactlyOnceWith('HEAD text');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(repository.show).toHaveBeenCalledOnce();
		expect(repository.checkIgnore).toHaveBeenCalledOnce();
	});

	it.each(['missing', 'activation failure', 'API failure', 'disabled'])('reports null for %s Git', async (kind) => {
		if (kind === 'missing') vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);
		if (kind === 'activation failure') activate.mockRejectedValue(new Error('activation failed'));
		if (kind === 'API failure') git.getAPI.mockImplementation(() => { throw new Error('disabled'); });
		if (kind === 'disabled') git.enabled = false;
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
		expect(repository.show).not.toHaveBeenCalled();
		if (kind === 'disabled') expect(git.getAPI).not.toHaveBeenCalled();
	});

	it('discovers a repository opened after initialization and clears the base on close', async () => {
		api.getRepository.mockReturnValue(null);
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenLastCalledWith(null);
		api.getRepository.mockReturnValue(repository);
		opened.fire(repository);
		await flush();
		expect(onBase).toHaveBeenLastCalledWith('HEAD text');
		api.getRepository.mockReturnValue(null);
		closed.fire(repository);
		await flush();
		expect(onBase).toHaveBeenLastCalledWith(null);
		expect(repository.changed.listeners.size).toBe(0);
	});

	it('debounces state events and reads the latest HEAD commit', async () => {
		const { onBase } = start();
		await flush();
		repository.state.HEAD = { commit: 'commit-two' };
		repository.changed.fire();
		await vi.advanceTimersByTimeAsync(100);
		repository.state.HEAD = { commit: 'commit-three' };
		repository.show.mockResolvedValue('new HEAD');
		repository.changed.fire();
		await vi.advanceTimersByTimeAsync(149);
		expect(repository.show).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(repository.show).toHaveBeenCalledTimes(2);
		expect(repository.show).toHaveBeenLastCalledWith('commit-three', uri.fsPath);
		expect(onBase).toHaveBeenLastCalledWith('new HEAD');
	});

	it('rebinds to a replacement repository and removes the old listener', async () => {
		const { onBase } = start();
		await flush();
		const previous = repository;
		repository = makeRepository('replacement');
		repository.show.mockResolvedValue('replacement text');
		opened.fire(repository);
		await flush();
		expect(previous.changed.listeners.size).toBe(0);
		expect(repository.changed.listeners.size).toBe(1);
		expect(onBase).toHaveBeenLastCalledWith('replacement text');
	});

	it('clears and resumes tracking when Git is disabled and enabled', async () => {
		const { onBase } = start();
		await flush();
		git.enabled = false;
		enablement.fire(false);
		await flush();
		expect(onBase).toHaveBeenLastCalledWith(null);
		expect(repository.changed.listeners.size).toBe(0);
		expect(opened.listeners.size).toBe(0);
		git.enabled = true;
		enablement.fire(true);
		await flush();
		expect(onBase).toHaveBeenLastCalledWith('HEAD text');
		expect(repository.changed.listeners.size).toBe(1);
		expect(opened.listeners.size).toBe(1);
	});

	it.each([undefined, {}])('treats an unborn HEAD %j as a new file without reading Git objects', async (head) => {
		repository.state.HEAD = head;
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith('');
		expect(repository.show).not.toHaveBeenCalled();
		expect(repository.getObjectDetails).not.toHaveBeenCalled();
		repository.state.HEAD = { commit: 'first-commit' };
		repository.changed.fire();
		await flush();
		expect(onBase).toHaveBeenLastCalledWith('HEAD text');
	});

	it.each([true, false])('excludes ignored files, including unborn repositories (has HEAD: %s)', async (hasHead) => {
		if (!hasHead) repository.state.HEAD = undefined;
		repository.checkIgnore.mockResolvedValue(new Set([uri.fsPath]));
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
		expect(repository.show).not.toHaveBeenCalled();
		expect(repository.getObjectDetails).not.toHaveBeenCalled();
	});

	it('rechecks ignore changes even when HEAD is unchanged', async () => {
		repository.checkIgnore.mockResolvedValue(new Set([uri.fsPath]));
		const { onBase } = start();
		await flush();
		repository.checkIgnore.mockResolvedValue(new Set());
		repository.changed.fire();
		await flush();
		expect(onBase.mock.calls).toEqual([[null], ['HEAD text']]);
	});

	it('recognizes an untracked/new path only after show fails and the object probe reports UnknownPath', async () => {
		repository.show.mockRejectedValue(new Error('show failed'));
		repository.getObjectDetails.mockRejectedValue({ gitErrorCode: 'UnknownPath' });
		const { onBase } = start();
		await flush();
		expect(repository.getObjectDetails).toHaveBeenCalledExactlyOnceWith('commit-one', uri.fsPath);
		expect(repository.show.mock.invocationCallOrder[0]).toBeLessThan(repository.getObjectDetails.mock.invocationCallOrder[0]);
		expect(onBase).toHaveBeenCalledExactlyOnceWith('');
	});

	it.each([null, undefined, 'UnknownPath', new Error('UnknownPath'), { gitErrorCode: 'BadRevision' }])(
		'does not mistake object lookup error %j for a new file', async (error) => {
			repository.show.mockRejectedValue({ gitErrorCode: 'UnknownPath' });
			repository.getObjectDetails.mockRejectedValue(error);
			const { onBase } = start();
			await flush();
			expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
		},
	);

	it('reports null when show fails for an object that exists', async () => {
		repository.show.mockRejectedValue(new Error('decode failed'));
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('reports null on ignore failure, then recovers on a later state event', async () => {
		repository.checkIgnore.mockRejectedValueOnce(new Error('Git failed'));
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
		expect(repository.show).not.toHaveBeenCalled();
		repository.changed.fire();
		await flush();
		expect(onBase).toHaveBeenLastCalledWith('HEAD text');
	});

	it('reports null if repository lookup fails', async () => {
		api.getRepository.mockImplementation(() => { throw new Error('lookup failed'); });
		const { onBase } = start();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('discards an obsolete show result during the debounce window', async () => {
		const pending = deferred<string>();
		repository.show.mockReturnValueOnce(pending.promise);
		const { onBase } = start();
		await flush();
		repository.state.HEAD = { commit: 'next' };
		repository.changed.fire();
		pending.resolve('stale');
		await vi.advanceTimersByTimeAsync(0);
		expect(onBase).not.toHaveBeenCalled();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith('HEAD text');
	});

	it('does not let an older read overwrite a completed newer read', async () => {
		const pending = deferred<string>();
		repository.show.mockReturnValueOnce(pending.promise);
		const { onBase } = start();
		await flush();
		repository.changed.fire();
		await flush();
		pending.resolve('stale');
		await vi.advanceTimersByTimeAsync(0);
		expect(onBase).toHaveBeenCalledExactlyOnceWith('HEAD text');
	});

	it('does not probe an obsolete failed show request', async () => {
		const pending = deferred<string>();
		repository.show.mockReturnValueOnce(pending.promise);
		const { onBase } = start();
		await flush();
		repository.changed.fire();
		pending.reject(new Error('stale failure'));
		await vi.advanceTimersByTimeAsync(0);
		expect(repository.getObjectDetails).not.toHaveBeenCalled();
		expect(onBase).not.toHaveBeenCalled();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith('HEAD text');
	});

	it('does not issue show after an ignore check becomes obsolete', async () => {
		const pending = deferred<Set<string>>();
		repository.checkIgnore.mockReturnValueOnce(pending.promise);
		const { onBase } = start();
		await flush();
		repository.changed.fire();
		pending.resolve(new Set());
		await vi.advanceTimersByTimeAsync(0);
		expect(repository.show).not.toHaveBeenCalled();
		expect(onBase).not.toHaveBeenCalled();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith('HEAD text');
	});

	it.each(['close', 'disable'])('invalidates pending reads immediately on repository %s', async (action) => {
		const pending = deferred<string>();
		repository.show.mockReturnValueOnce(pending.promise);
		const { onBase } = start();
		await flush();
		if (action === 'close') {
			api.getRepository.mockReturnValue(null);
			closed.fire(repository);
		} else {
			git.enabled = false;
			enablement.fire(false);
		}
		pending.resolve('stale');
		await vi.advanceTimersByTimeAsync(0);
		expect(onBase).not.toHaveBeenCalled();
		await flush();
		expect(onBase).toHaveBeenCalledExactlyOnceWith(null);
	});

	it.each(['resolve', 'reject'])('ignores activation %s after disposal', async (outcome) => {
		const pending = deferred<typeof git>();
		activate.mockReturnValue(pending.promise);
		const { tracker, onBase } = start();
		tracker.dispose();
		if (outcome === 'resolve') pending.resolve(git);
		else pending.reject(new Error('activation failed'));
		await flush();
		expect(onBase).not.toHaveBeenCalled();
		expect(git.getAPI).not.toHaveBeenCalled();
		expect(enablement.listeners.size).toBe(0);
	});

	it.each(['ignore', 'show', 'probe'])('suppresses pending %s results and releases subscriptions on disposal', async (phase) => {
		const pending = deferred<never>();
		if (phase === 'ignore') repository.checkIgnore.mockReturnValue(pending.promise);
		if (phase === 'show') repository.show.mockReturnValue(pending.promise);
		if (phase === 'probe') {
			repository.show.mockRejectedValue(new Error('show failed'));
			repository.getObjectDetails.mockReturnValue(pending.promise);
		}
		const { tracker, onBase } = start();
		await flush();
		tracker.dispose();
		tracker.dispose();
		pending.reject({ gitErrorCode: 'UnknownPath' });
		await flush();
		expect(onBase).not.toHaveBeenCalled();
		expect(repository.changed.listeners.size).toBe(0);
		expect(opened.listeners.size).toBe(0);
		expect(closed.listeners.size).toBe(0);
		expect(enablement.listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels a scheduled refresh on disposal', async () => {
		const { tracker, onBase } = start();
		await vi.advanceTimersByTimeAsync(0);
		tracker.dispose();
		await flush();
		expect(api.getRepository).not.toHaveBeenCalled();
		expect(onBase).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
