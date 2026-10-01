import { test, expect, type Page } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const doc = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}${[39, 44, 99].includes(i) ? ' needle' : ''}`).join('\n');
async function centered(page: Page, line: number) {
	await expect.poll(async () => {
		const target = (await page.locator('.cm-line').filter({ hasText: new RegExp(`^Line ${line} needle$`) }).boundingBox())!;
		const viewport = (await page.locator('.cm-scroller').boundingBox())!;
		return Math.abs(target.y + target.height / 2 - viewport.y - viewport.height / 2);
	}).toBeLessThan(25);
}

test('offscreen next and previous matches are centered', async ({ page }) => {
	await mountEditor(page, doc);
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.locator('button[name="next"]').click();
	await centered(page, 40);
	await page.locator('button[name="prev"]').click();
	await centered(page, 100);
});

test('an already visible match does not move the viewport', async ({ page }) => {
	await mountEditor(page, doc);
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.locator('button[name="next"]').click();
	await centered(page, 40);
	await expect(page.locator('.cm-line').filter({ hasText: /^Line 40 needle$/ }).locator('.cm-searchMatch-selected')).toBeVisible();
	const scrollTop = await page.locator('.cm-scroller').evaluate(e => e.scrollTop);
	await page.locator('button[name="next"]').click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Line 45 needle$/ }).locator('.cm-searchMatch-selected')).toBeVisible();
	await expect.poll(() => page.locator('.cm-scroller').evaluate(e => e.scrollTop)).toBe(scrollTop);
});

test('Enter and F3 follow the same offscreen centering behavior', async ({ page }) => {
	await mountEditor(page, doc);
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.keyboard.press('Enter');
	await centered(page, 40);
	await page.keyboard.press('Escape');
	await page.keyboard.press('F3');
	await page.keyboard.press('F3');
	await centered(page, 100);
});

test('an offscreen match in a rendered table is centered', async ({ page }) => {
	const before = Array.from({ length: 80 }, (_, i) => `Before ${i}`).join('\n');
	const after = Array.from({ length: 80 }, (_, i) => `After ${i}`).join('\n');
	await mountEditor(page, `${before}\n\n| Key | Value |\n|---|---|\n| needle | value |\n\n${after}`);
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.keyboard.press('Enter');
	const line = page.locator('.mlp-table td').filter({ hasText: /^needle$/ });
	await expect(line).toBeVisible();
	await expect.poll(async () => {
		const target = (await line.boundingBox())!;
		const viewport = (await page.locator('.cm-scroller').boundingBox())!;
		return Math.abs(target.y + target.height / 2 - viewport.y - viewport.height / 2);
	}).toBeLessThan(25);
});
