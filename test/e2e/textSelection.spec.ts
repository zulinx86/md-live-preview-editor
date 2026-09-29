import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('multiline selection stops at the text end of a completed source line', async ({ page }) => {
	const doc = 'First short line\nSecond short line\nLast line';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: doc.length } });
	await expect(page.locator('.cm-selectionBackground:visible').first()).toBeVisible();
	const bounds = await page.evaluate(() => {
		const line = document.querySelector('.cm-line')!;
		const range = document.createRange();
		range.selectNodeContents(line);
		const text = range.getBoundingClientRect();
		const y = (text.top + text.bottom) / 2;
		const rectangles = [...document.querySelectorAll('.cm-selectionBackground:not(.mlp-selected-newline)')].map(el => el.getBoundingClientRect());
		return { textEnd: text.right, selectedEnd: Math.max(...rectangles.filter(rect => rect.top <= y && rect.bottom >= y && rect.width > 0).map(rect => rect.right)) };
	});
	expect(bounds.selectedEnd).toBeLessThanOrEqual(bounds.textEnd + 1);
});

test('keeps a small visible selection mark on a selected blank line', async ({ page }) => {
	const doc = 'First\n\nLast';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: doc.length } });
	await expect(page.locator('.mlp-selected-newline:visible')).toHaveCount(2);
	const widths = await page.locator('.mlp-selected-newline:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
	expect(widths[1]).toBeGreaterThan(0);
	expect(widths[1]).toBeLessThan(20);
});

test('keeps secondary selections and their cursors visible', async ({ page }) => {
	await mountEditor(page, 'word one\nword two\nword three');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: 4 } });
	await page.keyboard.press('ControlOrMeta+d');
	await page.keyboard.press('ControlOrMeta+d');
	await expect(page.locator('.cm-selectionBackground:visible')).toHaveCount(3);
	await expect(page.locator('.cm-cursor-secondary')).toHaveCount(2);
});

test('does not change the selected Markdown or unfold unrelated folded content', async ({ page }) => {
	const doc = 'Intro\n\n## Section\n\nHidden body\n\n## Next\n\nLast';
	await mountEditor(page, doc);
	await page.locator('.mlp-section-fold-toggle:visible').first().click();
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: doc.length } });
	await expect(page.locator('.cm-line').filter({ hasText: 'Hidden body' })).toHaveCount(0);
	await postToWebview(page, { type: 'requestSelection', requestId: 1 });
	const messages = await page.evaluate(() => (window as any).__posted);
	expect(messages.find((message: any) => message.type === 'selection')).toEqual({ type: 'selection', requestId: 1, selection: { anchor: 0, head: doc.length } });
	expect(messages.filter((message: any) => message.type === 'edit')).toEqual([]);
});

test('a reversed multiline selection has the same text-bounded rectangles', async ({ page }) => {
	const doc = '日本語の短い行\nAnother line\nLast';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: doc.length, head: 0 } });
	await expect(page.locator('.cm-selectionBackground:not(.mlp-selected-newline):visible')).toHaveCount(3);
	const bounds = await page.locator('.cm-selectionBackground:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
	expect(Math.max(...bounds)).toBeLessThan(300);
});

test('selection spanning a rendered table keeps coverage across the widget', async ({ page }) => {
	const doc = 'Before\n\n| A | B |\n|---|---|\n| alpha | beta |\n\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: doc.length } });
	await expect(page.locator('.cm-selectionBackground:visible').first()).toBeVisible();
	const covered = await page.evaluate(() => {
		const table = document.querySelector('.mlp-table')!.getBoundingClientRect();
		const x = table.left + table.width / 2;
		const rectangles = [...document.querySelectorAll('.mlp-text-selection-layer .cm-selectionBackground')].map(element => element.getBoundingClientRect());
		return [table.top + 1, table.top + table.height / 2, table.bottom - 1].every(y =>
			rectangles.some(rect => rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom));
	});
	expect(covered).toBe(true);
});

test('distinguishes selecting text alone from including its following newline', async ({ page }) => {
	await mountEditor(page, 'First\nSecond');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: 5 } });
	await expect(page.locator('.mlp-selected-newline')).toHaveCount(0);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: 6 } });
	await expect(page.locator('.mlp-selected-newline:visible')).toHaveCount(1);
	await expect(page.locator('.mlp-selected-newline')).toHaveCSS('width', /px$/);
	expect(await page.locator('.mlp-selected-newline').evaluate(element => getComputedStyle(element, '::after').content)).toBe('"↵"');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: 5 } });
	await expect(page.locator('.mlp-selected-newline')).toHaveCount(0);
});

test('a newline-only selection shows its marker without changing selection data', async ({ page }) => {
	await mountEditor(page, 'First\nSecond');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 5, head: 6 } });
	await expect(page.locator('.mlp-selected-newline:visible')).toHaveCount(1);
	await expect(page.locator('.cm-selectionBackground:not(.mlp-selected-newline):visible')).toHaveCount(0);
	await postToWebview(page, { type: 'requestSelection', requestId: 2 });
	const response = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'selection'));
	expect(response.selection).toEqual({ anchor: 5, head: 6 });
});

test('does not mark wrapping or EOF as selected newlines', async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 700 });
	const doc = 'Wrapped text '.repeat(30);
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: doc.length } });
	await expect(page.locator('.cm-selectionBackground:visible').first()).toBeVisible();
	await expect(page.locator('.mlp-selected-newline')).toHaveCount(0);
});

test('marks a trailing newline but not the final empty line', async ({ page }) => {
	const doc = 'First\n';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: doc.length, head: 0 } });
	await expect(page.locator('.mlp-selected-newline:visible')).toHaveCount(1);
});
