import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('clicking a fragment link jumps to an offscreen heading', async ({ page }) => {
	await mountEditor(page, '[Go](#target-heading)\n\n' + 'Filler paragraph\n\n'.repeat(70) + '## Target Heading\n\n' + 'After\n\n'.repeat(25));
	await page.locator('.mlp-link').click();
	const heading = page.locator('.mlp-line-h2').filter({ hasText: 'Target Heading' });
	await expect(heading).toBeInViewport();
	await expect.poll(() => page.evaluate(() => {
		const scroller = document.querySelector('.cm-scroller')!;
		const viewport = scroller.getBoundingClientRect();
		const cursor = document.querySelector('.cm-cursor')!.getBoundingClientRect();
		return Math.abs((cursor.top + cursor.bottom) / 2 - (viewport.top + scroller.clientTop + scroller.clientHeight / 2));
	})).toBeLessThan(2);
});


test('a percent-encoded Japanese reference link jumps within the current preview', async ({ page }) => {
	const text = '[Go][ref]\n\n[ref]: #%E6%97%A5%E6%9C%AC%E8%AA%9E\n\n' + 'Filler\n\n'.repeat(70) + '## 日本語\n\n' + 'After\n\n'.repeat(25);
	await mountEditor(page, text);
	await page.locator('.mlp-link').click();
	await expect(page.locator('.mlp-line-h2').filter({ hasText: '日本語' })).toBeInViewport();
	expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink'))).toEqual([]);
});

test('a table fragment link uses modified click and centers the second duplicate heading', async ({ page }) => {
	const text = 'Intro\n\n| Link |\n|---|\n| [Go](#target-1) |\n\n## Target\n\n' + 'Filler\n\n'.repeat(70) + '## Target\n\n' + 'After\n\n'.repeat(25);
	await mountEditor(page, text);
	await page.locator('.mlp-table .mlp-link').click({ modifiers: ['ControlOrMeta'] });
	await expect(page.locator('.mlp-line-h2').filter({ hasText: 'Target' })).toBeInViewport();
	await page.keyboard.type('X');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').flatMap((m: any) => m.changes))).toContainEqual(expect.objectContaining({ from: text.lastIndexOf('## Target'), insert: 'X' }));
});

test('missing targets leave the preview position unchanged', async ({ page }) => {
	await mountEditor(page, '[Missing](#missing)\n\n' + 'Filler\n\n'.repeat(100));
	await page.locator('.mlp-link').click();
	expect(await page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBe(0);
	expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink'))).toEqual([]);
});

test('heading edits are reflected before navigating', async ({ page }) => {
	const text = '[Go](#new)\n\n' + 'Filler\n\n'.repeat(70) + '## Old\n\nAfter';
	await mountEditor(page, text);
	const from = text.indexOf('Old');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + 3, insert: 'New' }] });
	await page.locator('.mlp-link').click();
	await expect(page.locator('.mlp-line-h2').filter({ hasText: 'New' })).toBeInViewport();
});


test('an empty fragment returns to the beginning of the document', async ({ page }) => {
	const text = 'Beginning\n\n' + 'Filler\n\n'.repeat(70) + '[Back](#)';
	await mountEditor(page, text);
	await postToWebview(page, { type: 'jumpToLine', line: text.split('\n').length });
	await page.locator('.mlp-link').click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Beginning$/ })).toBeInViewport();
});
