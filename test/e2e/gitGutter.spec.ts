import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const base = 'keep\nold\nmiddle\nremove\nend';
const current = 'keep\nnew\nmiddle\nend\nadded';

test('distinguishes added, modified, and deleted source lines', async ({ page }) => {
	await mountEditor(page, current);
	await postToWebview(page, { type: 'gitBase', text: base });
	for (const kind of ['added', 'modified', 'deleted']) {
		await expect(page.locator(`.mlp-git-${kind}`)).toHaveCount(1);
		await expect(page.locator(`.mlp-git-${kind}`)).toBeVisible();
	}
	const added = await page.locator('.mlp-git-added').boundingBox();
	const line = await page.locator('.cm-line').filter({ hasText: /^added$/ }).boundingBox();
	expect(Math.abs(added!.y - line!.y)).toBeLessThan(1);
	await expect(page.locator('.mlp-git-added')).toHaveCSS('background-color', 'rgb(129, 184, 139)');
	await expect(page.locator('.mlp-git-modified')).toHaveCSS('background-color', 'rgb(86, 156, 214)');
	await expect(page.locator('.mlp-git-deleted')).toHaveCSS('border-left-color', 'rgb(241, 76, 76)');
});

test('updates markers for unsaved typing and clears them when HEAD catches up', async ({ page }) => {
	await mountEditor(page, 'same');
	await postToWebview(page, { type: 'gitBase', text: 'same' });
	await expect(page.locator('.mlp-git-marker')).toHaveCount(0);
	await postToWebview(page, { type: 'jumpToLine', line: 1, column: 5 });
	await page.keyboard.type('X');
	await expect(page.locator('.mlp-git-modified')).toHaveCount(1);
	await postToWebview(page, { type: 'gitBase', text: 'sameX' });
	await expect(page.locator('.mlp-git-marker')).toHaveCount(0);
});

test('external edits also update markers against HEAD', async ({ page }) => {
	await mountEditor(page, 'same');
	await postToWebview(page, { type: 'gitBase', text: 'same' });
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 4, insert: 'different' }] });
	await expect(page.locator('.mlp-git-modified')).toHaveCount(1);
	await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from: 0, to: 9, insert: 'same' }] });
	await expect(page.locator('.mlp-git-marker')).toHaveCount(0);
});

test('marks new files and clears stale markers when Git becomes unavailable', async ({ page }) => {
	await mountEditor(page, 'first\nsecond');
	await postToWebview(page, { type: 'gitBase', text: '' });
	await expect(page.locator('.mlp-git-added')).toHaveCount(2);
	await postToWebview(page, { type: 'gitBase', text: null });
	await expect(page.locator('.mlp-git-marker')).toHaveCount(0);
});

test('shows deletion at EOF and when all content was deleted', async ({ page }) => {
	await mountEditor(page, 'keep');
	await postToWebview(page, { type: 'gitBase', text: 'keep\nremoved' });
	await expect(page.locator('.mlp-git-deleted.mlp-git-after')).toBeVisible();
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 4, insert: '' }] });
	await expect(page.locator('.mlp-git-deleted.mlp-git-before')).toBeVisible();
});

test('keeps changes visible in collapsed fence lines', async ({ page }) => {
	const doc = 'Intro\n\n```js\nbody\n```\n\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'gitBase', text: doc.replace('```js', '```text') });
	await expect(page.locator('.mlp-line-code-fence')).toHaveCount(2);
	await expect(page.locator('.mlp-git-modified')).toBeVisible();
});

test('marks changes inside a rendered table', async ({ page }) => {
	const doc = 'Intro\n\n| A | B |\n|---|---|\n| new | value |\n\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'gitBase', text: doc.replace('| new |', '| old |') });
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.mlp-git-modified')).toBeVisible();
});


test('an internal table deletion is a block change until source reveals its position', async ({ page }) => {
	const doc = 'Intro\n\n| A | B |\n|---|---|\n| keep | 1 |\n| last | 3 |\n\nAfter';
	const head = doc.replace('| last | 3 |', '| removed | 2 |\n| last | 3 |');
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'gitBase', text: head });
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.mlp-git-modified')).toBeVisible();
	await expect(page.locator('.mlp-git-deleted')).toHaveCount(0);
	await postToWebview(page, { type: 'jumpToLine', line: 6, column: 3 });
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect(page.locator('.mlp-git-deleted.mlp-git-before')).toBeVisible();
});
