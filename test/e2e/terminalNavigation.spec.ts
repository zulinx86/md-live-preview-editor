import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const lines = Array.from({ length: 120 }, (_, i) => `Line ${String(i + 1).padStart(3, '0')} sample`);
const documentText = lines.join('\n');

for (const { name, line, column } of [
	{ name: 'a line far below the viewport', line: 90, column: 4 },
	{ name: 'the first column when omitted', line: 20, column: undefined },
	{ name: 'a column beyond the line end', line: 50, column: 500 },
]) {
	test(`location navigation reaches ${name}`, async ({ page }) => {
		await mountEditor(page, documentText);
		await postToWebview(page, { type: 'jumpToLine', line, column });
		const target = page.locator('.cm-line').filter({ hasText: lines[line - 1] });
		await expect(target).toBeInViewport();
		await page.keyboard.type('X');
		const prefix = lines.slice(0, line - 1).join('\n');
		const expectedOffset = prefix.length + (line > 1 ? 1 : 0)
			+ Math.min((column ?? 1) - 1, lines[line - 1].length);
		await expect.poll(() => page.evaluate(() => {
			const posted = (window as unknown as { __posted: Array<{ type: string; changes?: Array<{ from: number; insert: string }> }> }).__posted;
			return posted.filter((m) => m.type === 'edit').flatMap((m) => m.changes ?? []);
		})).toContainEqual(expect.objectContaining({ from: expectedOffset, insert: 'X' }));
	});
}

test('a second navigation moves the existing preview again', async ({ page }) => {
	await mountEditor(page, documentText);
	await postToWebview(page, { type: 'jumpToLine', line: 100, column: 5 });
	await expect(page.locator('.cm-line').filter({ hasText: lines[99] })).toBeInViewport();
	await postToWebview(page, { type: 'jumpToLine', line: 3, column: 1 });
	await expect(page.locator('.cm-line').filter({ hasText: lines[2] })).toBeInViewport();
	await page.keyboard.type('X');
	await expect(page.locator('.cm-line').filter({ hasText: 'XLine 003 sample' })).toBeVisible();
});


test('navigation reveals a table row after a previous cell click', async ({ page }) => {
	const doc = 'Intro\n\n| a | b |\n|---|---|\n| x | y |\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await postToWebview(page, { type: 'jumpToLine', line: 4, column: 2 });
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: '|---|---|' })).toBeInViewport();
});


test('jump centers the target line, including a line already in view', async ({ page }) => {
	await mountEditor(page, documentText);
	for (const line of [20, 90, 30]) {
		await postToWebview(page, { type: 'jumpToLine', line, column: 4 });
		await expect(page.locator('.cm-line').filter({ hasText: lines[line - 1] })).toBeInViewport();
		await expect.poll(() => page.evaluate(() => {
			const scroller = document.querySelector('.cm-scroller')!;
			const viewport = scroller.getBoundingClientRect();
			const cursor = document.querySelector('.cm-cursor')!.getBoundingClientRect();
			return Math.abs((cursor.top + cursor.bottom) / 2
				- (viewport.top + scroller.clientTop + scroller.clientHeight / 2));
		})).toBeLessThan(2);
	}
});
