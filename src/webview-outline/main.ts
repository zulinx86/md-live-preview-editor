import type { HostToOutlineMessage, OutlineToHostMessage } from '../shared/messages';
import type { HeadingItem } from '../shared/headings';
import { t } from '../shared/i18n';

interface OutlineState { collapsed: Array<[string, string[]]>; }

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): OutlineState | undefined;
	setState(state: OutlineState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

function post(message: OutlineToHostMessage): void {
	api.postMessage(message);
}

const root = document.getElementById('mlp-outline-root')!;
const collapsedByDocument = new Map<string, Set<string>>(
	(api.getState()?.collapsed ?? []).map(([uri, keys]) => [uri, new Set(keys)]),
);

function saveFolds(): void {
	api.setState({ collapsed: [...collapsedByDocument].filter(([, keys]) => keys.size > 0)
		.map(([uri, keys]) => [uri, [...keys]]) });
}
let lastRender = '';

function renderEmpty(text: string): void {
	lastRender = '';
	root.replaceChildren();
	const p = document.createElement('p');
	p.className = 'mlp-empty';
	p.textContent = text;
	root.appendChild(p);
}

function renderHeadings(headings: HeadingItem[], documentUri: string): void {
	const signature = JSON.stringify([documentUri, headings]);
	if (signature === lastRender) return;
	if (headings.length === 0) {
		renderEmpty(t('outline.empty'));
		return;
	}
	lastRender = signature;
	const focused = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
	const focusKey = focused?.dataset.key;
	const focusClass = focused?.className;
	root.replaceChildren();
	let collapsed = collapsedByDocument.get(documentUri);
	if (!collapsed) collapsedByDocument.set(documentUri, collapsed = new Set());
	const knownKeys = new Set<string>();
	const list = document.createElement('ul');
	list.className = 'mlp-outline-list';
	type Path = Array<[number, string, number]>;
	const stack: Array<{ level: number; list: HTMLUListElement; path: Path; seen: Map<string, number> }> = [
		{ level: 0, list, path: [], seen: new Map() },
	];
	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();
		const parent = stack[stack.length - 1];
		// Heading paths keep folds stable when body edits move source line numbers.
		// Count duplicate siblings separately rather than folding equal labels together.
		const sibling = JSON.stringify([heading.level, heading.text]);
		const occurrence = parent.seen.get(sibling) ?? 0;
		parent.seen.set(sibling, occurrence + 1);
		const path: Path = [...parent.path, [heading.level, heading.text, occurrence]];
		const key = JSON.stringify(path);
		knownKeys.add(key);
		const item = parent.list.appendChild(document.createElement('li'));
		const row = item.appendChild(document.createElement('div'));
		row.className = `mlp-outline-item mlp-outline-level-${heading.level}`;
		const hasChildren = i + 1 < headings.length && headings[i + 1].level > heading.level;
		const control = row.appendChild(document.createElement(hasChildren ? 'button' : 'span'));
		control.className = 'mlp-outline-toggle';
		const label = row.appendChild(document.createElement('button'));
		label.type = 'button';
		label.className = 'mlp-outline-heading';
		label.dataset.key = key;
		label.textContent = heading.text || t('outline.untitled');
		label.title = label.textContent;
		label.addEventListener('click', () => post({ type: 'jumpToHeading', line: heading.line }));
		if (hasChildren) {
			const children = item.appendChild(document.createElement('ul'));
			children.className = 'mlp-outline-list';
			const button = control as HTMLButtonElement;
			button.type = 'button';
			button.dataset.key = key;
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', '0 0 16 16');
			svg.setAttribute('aria-hidden', 'true');
			const arrow = document.createElementNS(svg.namespaceURI, 'path');
			arrow.setAttribute('d', 'M5 3 L10 8 L5 13');
			svg.appendChild(arrow);
			button.appendChild(svg);
			const sync = () => {
				children.hidden = collapsed.has(key);
				button.setAttribute('aria-expanded', String(!children.hidden));
				button.title = `${t(children.hidden ? 'outline.expand' : 'outline.collapse')}: ${label.textContent}`;
				button.setAttribute('aria-label', button.title);
			};
			button.addEventListener('click', () => {
				if (collapsed.has(key)) collapsed.delete(key);
				else collapsed.add(key);
				sync();
				saveFolds();
			});
			sync();
			stack.push({ level: heading.level, list: children, path, seen: new Map() });
		}
	}
	for (const key of collapsed) if (!knownKeys.has(key)) collapsed.delete(key);
	saveFolds();
	root.appendChild(list);
	if (focusKey) {
		const target = [...root.querySelectorAll<HTMLElement>('button')].find(button =>
			button.dataset.key === focusKey && button.className === focusClass);
		target?.focus({ preventScroll: true });
	}
}

window.addEventListener('message', (event: MessageEvent<HostToOutlineMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'update':
			renderHeadings(message.headings, message.documentUri ?? '');
			break;
		case 'noDocument':
			renderEmpty(t('outline.noDocument'));
			break;
	}
});

renderEmpty(t('outline.noDocument'));
post({ type: 'ready' });
