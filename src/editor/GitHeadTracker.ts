import * as vscode from 'vscode';

// Only the members consumed from the built-in vscode.git API v1.
interface GitRepository {
	readonly state: {
		readonly HEAD: { readonly commit?: string } | undefined;
		readonly onDidChange: vscode.Event<void>;
	};
	checkIgnore(paths: string[]): Promise<Set<string>>;
	show(ref: string, path: string): Promise<string>;
	getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }>;
}

interface GitAPI {
	readonly onDidOpenRepository: vscode.Event<GitRepository>;
	readonly onDidCloseRepository: vscode.Event<GitRepository>;
	getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: vscode.Event<boolean>;
	getAPI(version: 1): GitAPI;
}

/** Delivers a document's HEAD text, empty text for new files, or null when unavailable. */
export class GitHeadTracker implements vscode.Disposable {
	private disposed = false;
	private revision = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private api: GitAPI | undefined;
	private enablementSubscription: vscode.Disposable | undefined;
	private repositorySubscription: vscode.Disposable | undefined;
	private apiSubscriptions: vscode.Disposable[] = [];

	/**
	 * Start tracking uri through the built-in Git extension.
	 * @param uri Open document whose HEAD content is needed.
	 * @param onBase Receives the baseline; null disables the diff.
	 */
	constructor(private readonly uri: vscode.Uri, private readonly onBase: (text: string | null) => void) {
		void this.initialize();
	}

	/** Stop tracking and suppress pending callbacks. Returns nothing. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.revision++;
		clearTimeout(this.timer);
		this.enablementSubscription?.dispose();
		this.clearRepositorySubscriptions();
	}

	private async initialize(): Promise<void> {
		try {
			const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
			if (extension) {
				const git = await extension.activate();
				if (this.disposed) return;
				this.enablementSubscription = git.onDidChangeEnablement(() => this.bindAPI(git));
				this.bindAPI(git);
				return;
			}
		} catch {
			// Missing, disabled, or failed activation leaves the diff unavailable.
		}
		if (!this.disposed) this.onBase(null);
	}

	private clearRepositorySubscriptions(): void {
		this.repositorySubscription?.dispose();
		this.repositorySubscription = undefined;
		this.apiSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
		this.api = undefined;
	}

	private bindAPI(git: GitExtension): void {
		if (this.disposed) return;
		this.clearRepositorySubscriptions();
		try {
			if (git.enabled) {
				this.api = git.getAPI(1);
				this.apiSubscriptions.push(
					this.api.onDidOpenRepository(() => this.scheduleRefresh()),
					this.api.onDidCloseRepository(() => this.scheduleRefresh()),
				);
			}
		} catch {
			this.clearRepositorySubscriptions();
		}
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		if (this.disposed) return;
		// Invalidate immediately: an old read may finish during the debounce window.
		const revision = ++this.revision;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.refresh(revision);
		}, 150);
	}

	private isCurrent(revision: number): boolean {
		return !this.disposed && revision === this.revision;
	}

	private async refresh(revision: number): Promise<void> {
		let base: string | null = null;
		try {
			this.repositorySubscription?.dispose();
			this.repositorySubscription = undefined;
			const repository = this.api?.getRepository(this.uri);
			if (repository) {
				// getRepository may return a new API wrapper each time; always rebind.
				this.repositorySubscription = repository.state.onDidChange(() => this.scheduleRefresh());
				base = await this.readBase(repository, revision);
			}
		} catch {
			// Operational errors must not turn the entire document into additions.
		}
		if (this.isCurrent(revision)) this.onBase(base);
	}

	private async readBase(repository: GitRepository, revision: number): Promise<string | null> {
		const commit = repository.state.HEAD?.commit;
		const path = this.uri.fsPath;
		const ignored = await repository.checkIgnore([path]);
		if (!this.isCurrent(revision) || ignored.has(path)) return null;
		if (!commit) return '';

		try {
			// show handles wrong-case paths internally; probing first would bypass that.
			return await repository.show(commit, path);
		} catch {
			if (!this.isCurrent(revision)) return null;
			try {
				await repository.getObjectDetails(commit, path);
			} catch (error) {
				if (typeof error === 'object' && error !== null
					&& 'gitErrorCode' in error && error.gitErrorCode === 'UnknownPath') return '';
			}
			return null;
		}
	}
}
