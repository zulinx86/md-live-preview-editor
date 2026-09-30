import { WidgetType, type EditorView } from '@codemirror/view';
import type { GitDiffHunk } from '../shared/gitLineChanges';
import { t } from '../shared/i18n';

/** Read-only source comparison displayed inline below a Git change marker. */
export class GitDiffPreview extends WidgetType {
	constructor(private readonly hunks: readonly GitDiffHunk[], private readonly close: (view: EditorView) => void) {
		super();
	}

	eq(other: GitDiffPreview): boolean { return this.hunks === other.hunks; }

	toDOM(view: EditorView): HTMLElement {
		const panel = document.createElement('div');
		panel.className = 'mlp-git-preview';
		panel.contentEditable = 'false';
		panel.setAttribute('role', 'region');
		panel.setAttribute('aria-label', t('git.preview'));
		const header = panel.appendChild(document.createElement('div'));
		header.className = 'mlp-git-preview-header';
		header.appendChild(document.createElement('span')).textContent = t('git.preview');
		const close = header.appendChild(document.createElement('button'));
		close.type = 'button';
		close.className = 'mlp-git-preview-close';
		close.textContent = '×';
		close.title = t('git.close');
		close.setAttribute('aria-label', t('git.close'));
		close.addEventListener('click', () => { this.close(view); view.focus(); });
		const body = panel.appendChild(document.createElement('div'));
		body.className = 'mlp-git-preview-body';
		body.tabIndex = 0;
		for (const hunk of this.hunks) {
			const pair = body.appendChild(document.createElement('div'));
			pair.className = 'mlp-git-preview-pair';
			for (const side of ['before', 'after'] as const) {
				const text = side === 'before' ? hunk.beforeText : hunk.afterText;
				const from = side === 'before' ? hunk.beforeFromLine : hunk.afterFromLine;
				const column = pair.appendChild(document.createElement('div'));
				column.className = `mlp-git-preview-${side}`;
				column.appendChild(document.createElement('div')).textContent = t(`git.${side}`);
				const source = column.appendChild(document.createElement('div'));
				source.className = 'mlp-git-preview-source';
				if (!text) {
					source.textContent = t('git.empty');
				} else {
					const lines = text.split('\n');
					if (text.endsWith('\n')) lines.pop();
					for (let i = 0; i < lines.length; i++) {
						const row = source.appendChild(document.createElement('div'));
						row.className = 'mlp-git-preview-line';
						const number = row.appendChild(document.createElement('span'));
						number.className = 'mlp-git-preview-number';
						number.textContent = String(from + i);
						number.setAttribute('aria-hidden', 'true');
						row.appendChild(document.createElement('span')).textContent = lines[i];
					}
					if (!text.endsWith('\n')) {
						const note = column.appendChild(document.createElement('div'));
						note.className = 'mlp-git-preview-note';
						note.textContent = t('git.noNewline');
					}
				}
			}
		}
		return panel;
	}

	ignoreEvent(): boolean { return true; }
}
