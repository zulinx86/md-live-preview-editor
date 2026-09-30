import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const panel = '.mlp-git-preview';

async function show(page: import('@playwright/test').Page, base: string, current: string) {
	await mountEditor(page, current);
	await postToWebview(page, { type: 'gitBase', text: base });
	await page.locator('.mlp-git-change-button').first().click();
	await expect(page.locator(panel)).toBeVisible();
}

test('clicking a modification shows before and after inline without editing', async ({ page }) => {
	await show(page, 'keep\nold\nend\n', 'keep\nnew\nend\n');
	await expect(page.locator('.mlp-git-preview-before')).toContainText('old');
	await expect(page.locator('.mlp-git-preview-after')).toContainText('new');
	await expect(page.locator('.mlp-git-preview-number')).toHaveText(['2', '2']);
	await expect(page.locator('.mlp-git-change-button')).toHaveCount(1);
	const messages = await page.evaluate(() => (window as any).__posted);
	expect(messages.filter((m: any) => m.type === 'edit')).toEqual([]);
	await page.locator('.mlp-git-change-button').click();
	await expect(page.locator(panel)).toHaveCount(0);
});

test('added and deleted hunks show an empty opposite side', async ({ page }) => {
	await show(page, 'keep\n', 'keep\nadded\n');
	await expect(page.locator('.mlp-git-preview-before')).toContainText('No lines');
	await expect(page.locator('.mlp-git-preview-after')).toContainText('added');
	await page.getByRole('button', { name: 'Close changes' }).click();
	await expect(page.locator(panel)).toHaveCount(0);
	await postToWebview(page, { type: 'gitBase', text: 'keep\nadded\nremoved\n' });
	await page.locator('.mlp-git-change-button').click();
	await expect(page.locator('.mlp-git-preview-before')).toContainText('removed');
	await expect(page.locator('.mlp-git-preview-after')).toContainText('No lines');
});

test('all content deleted and newline-only changes are inspectable', async ({ page }) => {
	await show(page, 'gone\n', '');
	await expect(page.locator('.mlp-git-preview-before')).toContainText('gone');
	await expect(page.locator('.mlp-git-preview-after')).toContainText('No lines');
	await show(page, 'same\n', 'same');
	await expect(page.locator('.mlp-git-preview-before .mlp-git-preview-note')).toHaveCount(0);
	await expect(page.locator('.mlp-git-preview-after .mlp-git-preview-note')).toHaveText('No newline at end of file');
});

test('editing or HEAD refresh closes a stale comparison', async ({ page }) => {
	await show(page, 'old', 'new');
	await postToWebview(page, { type: 'jumpToLine', line: 1, column: 4 });
	await page.keyboard.type('X');
	await expect(page.locator(panel)).toHaveCount(0);
	await page.locator('.mlp-git-change-button').click();
	await expect(page.locator('.mlp-git-preview-after')).toContainText('newX');
	await postToWebview(page, { type: 'gitBase', text: 'newX' });
	await expect(page.locator(panel)).toHaveCount(0);
	await expect(page.locator('.mlp-git-marker')).toHaveCount(0);
});

test('a table marker shows all its changed source hunks without revealing source', async ({ page }) => {
	const current = 'Intro\n\n| A | B |\n|---|---|\n| new | 1 |\n| keep | 2 |\n| final | 3 |\n\nAfter';
	const base = current.replace('| new |', '| old |').replace('| final |', '| prior |');
	await show(page, base, current);
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.mlp-git-preview-pair')).toHaveCount(2);
	await expect(page.locator('.mlp-git-preview-before').first()).toContainText('| old |');
	await expect(page.locator('.mlp-git-preview-after').last()).toContainText('| final |');
});

test('source is inert text and marker supports keyboard activation', async ({ page }) => {
	await mountEditor(page, '<img src=x onerror=alert(1)>');
	await postToWebview(page, { type: 'gitBase', text: 'old' });
	const button = page.locator('.mlp-git-change-button');
	await button.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator(panel)).toBeVisible();
	await expect(page.locator('.mlp-git-preview-after')).toContainText('<img src=x onerror=alert(1)>');
	await expect(page.locator(`${panel} img`)).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Close changes' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator(panel)).toHaveCount(0);
	await expect(page.locator('.cm-content')).toBeFocused();
});

test('long hunks scroll inside the comparison', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 700 });
	await show(page, '', Array.from({ length: 40 }, (_, i) => `added ${i}`).join('\n'));
	await expect(page.locator('.mlp-git-preview-body')).toHaveCSS('max-height', '300px');
	const scrolls = await page.locator('.mlp-git-preview-body').evaluate(e => e.scrollHeight > e.clientHeight);
	expect(scrolls).toBe(true);
});
