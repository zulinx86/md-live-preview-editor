import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

function number(page: Page, line: number) {
	return page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: new RegExp(`^${line}$`) });
}
async function selection(page: Page) {
	await page.evaluate(() => { (window as any).__posted.length = 0; });
	await postToWebview(page, { type: 'requestSelection', requestId: 1 });
	return page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'selection').selection);
}
async function drag(page: Page, from: number, to: number) {
	const a = (await number(page, from).boundingBox())!;
	const b = (await number(page, to).boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
	await page.mouse.up();
}

test('click selects source text and newline, with editor focus', async ({ page }) => {
	await mountEditor(page, 'First\nSecond\nLast');
	await number(page, 2).click();
	expect(await selection(page)).toEqual({ anchor: 6, head: 13 });
	await expect(page.locator('.mlp-selected-newline:visible')).toHaveCount(1);
	await expect(page.locator('.cm-content')).toBeFocused();
	await page.keyboard.type('Replacement');
	await expect(page.locator('.cm-content')).toContainText('ReplacementLast');
});

test('blank lines select their newline and EOF does not add one', async ({ page }) => {
	await mountEditor(page, 'First\n\nLast');
	await number(page, 2).click();
	expect(await selection(page)).toEqual({ anchor: 6, head: 7 });
	await number(page, 3).click();
	expect(await selection(page)).toEqual({ anchor: 7, head: 11 });
	await expect(page.locator('.mlp-selected-newline')).toHaveCount(0);
});

test('drag selects whole lines in both directions', async ({ page }) => {
	await mountEditor(page, 'One\nTwo\nThree\nFour');
	await drag(page, 2, 4);
	expect(await selection(page)).toEqual({ anchor: 4, head: 18 });
	await drag(page, 3, 1);
	expect(await selection(page)).toEqual({ anchor: 14, head: 0 });
});

test('a wrapped source line is selected in full', async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 700 });
	const long = 'long text '.repeat(30);
	await mountEditor(page, `First\n${long}\nLast`);
	await number(page, 2).click();
	expect(await selection(page)).toEqual({ anchor: 6, head: 7 + long.length });
});

test('right click does not select a line', async ({ page }) => {
	await mountEditor(page, 'First\nSecond\nLast');
	const before = await selection(page);
	await number(page, 2).click({ button: 'right' });
	expect(await selection(page)).toEqual(before);
});

test('dragging outside the viewport auto-scrolls and selects more lines', async ({ page }) => {
	await page.setViewportSize({ width: 700, height: 350 });
	await mountEditor(page, Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join('\n'));
	const a = (await number(page, 2).boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2, 349, { steps: 5 });
	await expect.poll(() => page.locator('.cm-scroller').evaluate(e => e.scrollTop)).toBeGreaterThan(50);
	await page.mouse.up();
	const selected = await selection(page);
	expect(selected.anchor).toBe(7);
	expect(selected.head).toBeGreaterThan(100);
});

test('shift click extends selection by source lines', async ({ page }) => {
	await mountEditor(page, 'One\nTwo\nThree\nFour');
	await number(page, 2).click();
	await number(page, 4).click({ modifiers: ['Shift'] });
	expect(await selection(page)).toEqual({ anchor: 4, head: 18 });
});

test('repeated shift clicks preserve the original anchor line', async ({ page }) => {
	await mountEditor(page, 'One\nTwo\nThree\nFour\nFive');
	await number(page, 3).click();
	await number(page, 1).click({ modifiers: ['Shift'] });
	expect(await selection(page)).toEqual({ anchor: 14, head: 0 });
	await number(page, 2).click({ modifiers: ['Shift'] });
	expect(await selection(page)).toEqual({ anchor: 14, head: 4 });
	await number(page, 1).click({ modifiers: ['Shift'] });
	expect(await selection(page)).toEqual({ anchor: 14, head: 0 });
	await number(page, 5).click({ modifiers: ['Shift'] });
	expect(await selection(page)).toEqual({ anchor: 8, head: 23 });
});
