import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

function toggles(page: Page) {
	return page.locator('.mlp-section-fold-toggle:visible');
}

const nested = 'Intro\n\n## Parent\n\nParent body\n\n### Child\n\nChild body\n\n### Sibling\n\nSibling body\n\n## Outside\n\nOutside body';

test('folding a section hides its body and child sections but keeps the next peer', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).first().click();
	await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: /^Parent body$/ })).toHaveCount(0);
	await expect(page.locator('.mlp-line-h3')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: /^Outside body$/ })).toBeVisible();
	await toggles(page).first().click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toBeVisible();
	await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'true');
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

test('a child keeps its folded state when its parent is collapsed and expanded', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).nth(1).click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: /^Sibling body$/ })).toBeVisible();
	await toggles(page).first().click();
	await toggles(page).first().click();
	await expect(page.locator('.mlp-line-h3').filter({ hasText: 'Child' })).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toHaveCount(0);
	await toggles(page).nth(1).click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toBeVisible();
});

test('rendered tables, diagrams and code blocks disappear inside a folded section', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n## Section\n\n| A | B |\n|---|---|\n| x | y |\n\n```mermaid\ngraph TD; A-->B\n```\n\n```text\nliteral code\n```\n\n## Next\n\nAfter');
	await expect(page.locator('.mlp-table')).toBeVisible();
	await toggles(page).first().click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect(page.locator('.mlp-mermaid-wrap')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: 'literal code' })).toHaveCount(0);
	await toggles(page).first().click();
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: 'literal code' })).toBeVisible();
});

test('jumping to a hidden heading unfolds its containing section', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).first().click();
	await postToWebview(page, { type: 'jumpToFragment', fragment: '#child' });
	await expect(page.locator('.mlp-line-h3').filter({ hasText: 'Child' })).toBeVisible();
	await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'true');
});

test('searching hidden body text unfolds the section', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).first().click();
	await page.keyboard.press('ControlOrMeta+f');
	await page.locator('input[name="search"]').pressSequentially('Child body');
	await page.locator('input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toBeVisible();
});

test('folded ranges follow edits before the section', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).first().click();
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 0, insert: 'New intro\n\n' }] });
	await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toHaveCount(0);
	await toggles(page).first().click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toBeVisible();
});

test('only document sections receive fold controls', async ({ page }) => {
	await mountEditor(page, '---\ntitle: test\n---\n\n```md\n# Fake heading\n```\n\n> ## Quoted heading\n> Quoted text\n\n## Empty\n\n## Real\n\nBody');
	await expect(toggles(page)).toHaveCount(1);
	await toggles(page).first().click();
	await expect(page.locator('.cm-line').filter({ hasText: /^Body$/ })).toHaveCount(0);
});

test('changing a folded heading level reveals the changed section boundary', async ({ page }) => {
	await mountEditor(page, nested);
	await toggles(page).nth(1).click();
	const from = nested.indexOf('### Child');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + 1, insert: '' }] });
	await expect(page.locator('.cm-line').filter({ hasText: /^Child body$/ })).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: /^Sibling body$/ })).toBeVisible();
});

for (const navigation of ['jumpToLine', 'restoreSelection', 'setCursor']) {
	test(`${navigation} reveals the end of a folded final section`, async ({ page }) => {
		const doc = 'Intro\n\n## Final\n\nLast line';
		await mountEditor(page, doc);
		await toggles(page).first().click();
		const message = navigation === 'jumpToLine' ? { type: navigation, line: 5, column: 10 }
			: navigation === 'restoreSelection' ? { type: navigation, selection: { anchor: doc.length, head: doc.length } }
			: { type: navigation, pos: doc.length };
		await postToWebview(page, message);
		await expect(page.locator('.cm-line').filter({ hasText: /^Last line$/ })).toBeVisible();
	});
}

test('a search ending at EOF reveals the final section', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n## Final\n\nLast needle');
	await toggles(page).first().click();
	await page.keyboard.press('ControlOrMeta+f');
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.locator('input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: /^Last needle$/ })).toBeVisible();
});
