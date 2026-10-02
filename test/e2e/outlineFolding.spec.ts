import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
type HeadingItem = { level: number; text: string; line: number };

const headings: HeadingItem[] = [
	{ level: 2, text: 'Parent', line: 1 },
	{ level: 3, text: 'Child', line: 3 },
	{ level: 4, text: 'Grandchild', line: 5 },
	{ level: 3, text: 'Sibling', line: 7 },
	{ level: 2, text: 'Next', line: 9 },
];
async function update(page: Page, items = headings, documentUri = 'file:///one.md', css?: string) {
	await page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: message })), {
		type: 'update', headings: items, documentUri, css,
	});
}
async function mount(page: Page, savedState?: unknown) {
	await page.goto('about:blank');
	const root = join(__dirname, '..', '..');
	await page.setContent('<div id="mlp-outline-root"></div>');
	await page.addStyleTag({ content: readFileSync(join(root, 'media/webview-outline-style.css'), 'utf8') });
	await page.evaluate(saved => {
		(window as any).__state = saved;
		(window as any).mlpLocale = 'en';
		(window as any).__posted = [];
		(window as any).acquireVsCodeApi = () => ({
			postMessage: (m: unknown) => (window as any).__posted.push(m),
			getState: () => (window as any).__state,
			setState: (state: unknown) => { (window as any).__state = state; },
		});
	}, savedState);
	await page.addScriptTag({ content: readFileSync(join(root, 'dist/webview-outline.js'), 'utf8') });
	await update(page);
}
const heading = (page: Page, text: string) => page.getByRole('button', { name: text, exact: true });
const toggle = (page: Page, text: string) => page.getByRole('button', { name: new RegExp(`^(Collapse|Expand) heading: ${text}$`) });

test.beforeEach(async ({ page }) => { await mount(page); });

test('collapses descendants and restores their own fold state', async ({ page }) => {
	await toggle(page, 'Child').click();
	await expect(heading(page, 'Grandchild')).toBeHidden();
	await toggle(page, 'Parent').click();
	await expect(heading(page, 'Child')).toBeHidden();
	await expect(heading(page, 'Sibling')).toBeHidden();
	await expect(heading(page, 'Next')).toBeVisible();
	await toggle(page, 'Parent').click();
	await expect(heading(page, 'Child')).toBeVisible();
	await expect(heading(page, 'Grandchild')).toBeHidden();
	await expect(heading(page, 'Sibling')).toBeVisible();
});

test('only parents have toggles and toggling never jumps to the document', async ({ page }) => {
	await expect(page.locator('button.mlp-outline-toggle')).toHaveCount(2);
	await toggle(page, 'Parent').click();
	expect(await page.evaluate(() => (window as any).__posted)).toEqual([{ type: 'ready' }]);
	await heading(page, 'Parent').click();
	expect(await page.evaluate(() => (window as any).__posted.at(-1))).toEqual({ type: 'jumpToHeading', line: 1 });
	await expect(toggle(page, 'Parent')).toHaveAttribute('aria-expanded', 'false');
});

test('keeps folds when source lines change and uses updated jump locations', async ({ page }) => {
	await toggle(page, 'Parent').click();
	await update(page, headings.map(h => ({ ...h, line: h.line + 10 })));
	await expect(heading(page, 'Child')).toBeHidden();
	await heading(page, 'Parent').click();
	expect(await page.evaluate(() => (window as any).__posted.at(-1))).toEqual({ type: 'jumpToHeading', line: 11 });
});

test('fold state is independent per document and survives temporary no-document state', async ({ page }) => {
	await toggle(page, 'Parent').click();
	await update(page, headings, 'file:///two.md');
	await expect(heading(page, 'Child')).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'noDocument' } })));
	await expect(page.locator('.mlp-empty')).toBeVisible();
	await update(page);
	await expect(heading(page, 'Child')).toBeHidden();
});

test('handles skipped levels and duplicate heading labels independently', async ({ page }) => {
	await update(page, [
		{ level: 2, text: 'Same', line: 1 }, { level: 5, text: 'First child', line: 3 },
		{ level: 2, text: 'Same', line: 5 }, { level: 4, text: 'Second child', line: 7 },
	]);
	await page.locator('button.mlp-outline-toggle').first().click();
	await expect(heading(page, 'First child')).toBeHidden();
	await expect(heading(page, 'Second child')).toBeVisible();
});

test('keyboard toggling keeps focus and headings still activate with Enter', async ({ page }) => {
	await toggle(page, 'Parent').focus();
	await page.keyboard.press('Enter');
	await expect(toggle(page, 'Parent')).toBeFocused();
	await expect(heading(page, 'Child')).toBeHidden();
	await update(page, headings.map(h => ({ ...h, line: h.line + 1 })));
	await expect(toggle(page, 'Parent')).toBeFocused();
	await page.keyboard.press('Space');
	await expect(heading(page, 'Child')).toBeVisible();
	await heading(page, 'Child').focus();
	await page.keyboard.press('Enter');
	expect(await page.evaluate(() => (window as any).__posted.at(-1))).toEqual({ type: 'jumpToHeading', line: 4 });
});

test('empty outlines remain readable and heading text is inert', async ({ page }) => {
	await update(page, []);
	await expect(page.locator('.mlp-empty')).toHaveText('No headings.');
	await update(page, [{ level: 1, text: '<img src=x>', line: 1 }]);
	await expect(heading(page, '<img src=x>')).toBeVisible();
	await expect(page.locator('img')).toHaveCount(0);
});

test('restores folds after the outline webview is recreated', async ({ page }) => {
	await toggle(page, 'Parent').click();
	const saved = await page.evaluate(() => (window as any).__state);
	await mount(page, saved);
	await expect(heading(page, 'Child')).toBeHidden();
	await expect(toggle(page, 'Parent')).toHaveAttribute('aria-expanded', 'false');
});

test('outline headings and vertical guides follow the active heading palette', async ({ page }) => {
	await update(page, headings, 'file:///one.md', 'h2 { color: #89decf; } h3 { color: #a8c7fa; } h4 { color: #c8b6ef; }');
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(137, 222, 207)');
	await expect(heading(page, 'Child')).toHaveCSS('color', 'rgb(168, 199, 250)');
	const guide = page.locator('.mlp-outline-children').first();
	expect(await guide.evaluate(e => getComputedStyle(e, '::before').borderLeftColor)).toBe('rgb(137, 222, 207)');
	expect(await guide.evaluate(e => getComputedStyle(e, '::before').borderLeftWidth)).toBe('1px');
	await toggle(page, 'Parent').click();
	await update(page, headings, 'file:///one.md', 'h2 { color: #f1809e; }');
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(241, 128, 158)');
	await expect(heading(page, 'Child')).toBeHidden();
});

test('palette supports CSS variables and theme classes without applying layout rules', async ({ page }) => {
	await page.evaluate(() => document.body.classList.add('vscode-dark'));
	const css = ':root { --heading: #a8c7fa; } body { color: #c5c5c5; } body.vscode-dark h2 { color: var(--heading); } body.vscode-light h2 { color: #f1809e; } button { font-size: 90px; }';
	await update(page, headings, 'file:///one.md', css);
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(168, 199, 250)');
	await expect(heading(page, 'Child')).toHaveCSS('color', 'rgb(197, 197, 197)');
	await expect(heading(page, 'Parent')).not.toHaveCSS('font-size', '90px');
	await page.evaluate(() => { document.body.className = 'vscode-light'; });
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(241, 128, 158)');
});

test('palette preserves root specificity and editor ancestor selectors', async ({ page }) => {
	await update(page, headings, 'file:///one.md', ':root { --h: red; } html { --h: blue; } #mlp-root .cm-scroller h2 { color: var(--h); }');
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(255, 0, 0)');
});

test('palette follows theme attribute changes', async ({ page }) => {
	await page.evaluate(() => { document.body.className = 'vscode-dark'; document.body.dataset.vscodeThemeName = 'First'; });
	await update(page, headings, 'file:///one.md', 'body.vscode-dark[data-vscode-theme-name="First"] h2 { color: red; } body.vscode-dark[data-vscode-theme-name="Second"] h2 { color: blue; }');
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(255, 0, 0)');
	await page.evaluate(() => { document.body.dataset.vscodeThemeName = 'Second'; });
	await expect(heading(page, 'Parent')).toHaveCSS('color', 'rgb(0, 0, 255)');
});
