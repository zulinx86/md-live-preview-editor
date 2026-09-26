import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';
import type { Page } from '@playwright/test';

async function visibleNumbers(page: Page): Promise<string[]> {
	return page.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll((elements) =>
		elements.filter((el) => getComputedStyle(el).visibility !== 'hidden'
			&& el.getBoundingClientRect().height > 0).map((el) => el.textContent ?? ''));
}

test('shows source line numbers including blank lines', async ({ page }) => {
	await mountEditor(page, 'First\n\nThird');
	await expect.poll(() => visibleNumbers(page)).toEqual(['1', '2', '3']);
	const gutter = await page.locator('.cm-lineNumbers').boundingBox();
	const content = await page.locator('.cm-content').boundingBox();
	expect(gutter!.x + gutter!.width).toBeLessThanOrEqual(content!.x);
});

test('collapsed fences do not overlap numbers or renumber later source lines', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```text\ncode\n```\n\nAfter');
	await expect.poll(() => visibleNumbers(page)).toEqual(['1', '2', '4', '6', '7']);
	const hiddenNumber = page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^3$/ });
	await expect(hiddenNumber).toHaveCSS('overflow', 'hidden');
	await expect(hiddenNumber).toHaveCSS('height', '0px');
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	await expect.poll(() => visibleNumbers(page)).toEqual(['1', '2', '3', '4', '6', '7']);
});

test('wrapped text keeps one number per source line', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 700 });
	await mountEditor(page, 'First\n' + 'long text '.repeat(40) + '\nThird');
	await expect.poll(() => visibleNumbers(page)).toEqual(['1', '2', '3']);
	const lines = page.locator('.cm-line');
	expect((await lines.nth(1).boundingBox())!.height).toBeGreaterThan((await lines.nth(0).boundingBox())!.height * 2);
});

test('numbers update after inserting a newline', async ({ page }) => {
	await mountEditor(page, 'First\nSecond');
	await postToWebview(page, { type: 'jumpToLine', line: 2, column: 7 });
	await page.keyboard.press('Enter');
	await expect.poll(() => visibleNumbers(page)).toEqual(['1', '2', '3']);
});

test('a line number aligns with its source line after a jump', async ({ page }) => {
	const doc = Array.from({ length: 120 }, (_, i) => `Source ${i + 1}`).join('\n');
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'jumpToLine', line: 90 });
	const number = page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^90$/ });
	await expect(number).toBeInViewport();
	await expect.poll(async () => {
		const numberBox = await number.boundingBox();
		const lineBox = await page.locator('.cm-line').filter({ hasText: /^Source 90$/ }).boundingBox();
		return Math.abs(numberBox!.y - lineBox!.y);
	}).toBeLessThan(1);
});

test('a rendered table does not change subsequent source numbers', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| A | B |\n|---|---|\n| x | y |\n\nAfter');
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^7$/ })).toBeVisible();
});
