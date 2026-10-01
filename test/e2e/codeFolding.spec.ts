import { test, expect, type Page } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

const toggles = (page: Page) => page.locator('[data-fold-kind="code"]:visible');
const doc = 'Intro\n\n```js\nfirst();\nsecond();\n```\n\nAfter';

test('folds to the opening fence and expands without changing Markdown', async ({ page }) => {
	await mountEditor(page, doc);
	await expect(toggles(page)).toHaveCount(1);
	await toggles(page).click();
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.cm-line').filter({ hasText: /^```js$/ })).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: /^first\(\);$/ })).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: /^After$/ })).toBeVisible();
	await toggles(page).click();
	await expect(page.locator('.cm-line').filter({ hasText: /^second\(\);$/ })).toBeVisible();
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'true');
	expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
});

for (const block of ['```\nonly\n```', '~~~text\nbody\n~~~', '```\n```', '```js\none\ntwo']) {
	test(`folds and expands ${JSON.stringify(block)}`, async ({ page }) => {
		await mountEditor(page, `Intro\n\n${block}`);
		await toggles(page).click();
		await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
		await toggles(page).click();
		await expect(toggles(page)).toHaveAttribute('aria-expanded', 'true');
	});
}

test('retains a code fold inside a collapsed and expanded section', async ({ page }) => {
	await mountEditor(page, `Intro\n\n## Section\n\n${doc}\n\n## Next\n\nEnd`);
	await toggles(page).click();
	const section = page.locator('[data-fold-kind="section"]:visible').first();
	await section.click();
	await expect(toggles(page)).toHaveCount(0);
	await section.click();
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
});

test('search and explicit line jumps reveal folded code', async ({ page }) => {
	await mountEditor(page, doc);
	await toggles(page).click();
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('second');
	await page.keyboard.press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: /^second\(\);$/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await toggles(page).click();
	await postToWebview(page, { type: 'jumpToLine', line: 4, column: 2 });
	await expect(page.locator('.cm-line').filter({ hasText: /^first\(\);$/ })).toBeVisible();
});

test('fold survives an edit before it and clears when its fence is removed', async ({ page }) => {
	await mountEditor(page, doc);
	await toggles(page).click();
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 0, insert: 'Prefix\n' }] });
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
	await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from: 14, to: 19, insert: 'plain' }] });
	await expect(page.locator('.cm-line').filter({ hasText: /^first\(\);$/ })).toBeVisible();
});

test('code inside a list and quote remains foldable', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n- Parent\n\n  ```js\n  one\n  two\n  ```\n\n> ```text\n> quoted\n> ```\n\nAfter');
	await expect(toggles(page)).toHaveCount(2);
	await toggles(page).first().click();
	await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'false');
	await toggles(page).last().click();
	await expect(toggles(page).last()).toHaveAttribute('aria-expanded', 'false');
	await toggles(page).last().click();
	await expect(page.locator('.cm-line').filter({ hasText: /quoted/ })).toBeVisible();
});

test('indented code keeps its first line when folded', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n    first\n    second\n\nAfter');
	await toggles(page).click();
	await expect(page.locator('.cm-line').filter({ hasText: /first/ })).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: /second/ })).toHaveCount(0);
	await toggles(page).click();
	await expect(page.locator('.cm-line').filter({ hasText: /second/ })).toBeVisible();
});

test('source cursor does not duplicate the code folding control', async ({ page }) => {
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'jumpToLine', line: 3, column: 2 });
	await expect(toggles(page)).toHaveCount(1);
	await toggles(page).click();
	await expect(toggles(page)).toHaveCount(1);
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a fence sharing a list marker keeps its code control reachable', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n- ```js\n  first\n  second\n  ```\n\nAfter');
	await expect(toggles(page)).toHaveCount(1);
	await toggles(page).click();
	await expect(toggles(page)).toHaveAttribute('aria-expanded', 'false');
	await toggles(page).click();
	await expect(page.locator('.cm-line').filter({ hasText: /second/ })).toBeVisible();
});
