import { test, expect } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

const count = '.mlp-search-count';
test('shows total, current index, and wraparound for next and previous', async ({ page }) => {
	await mountEditor(page, 'Intro\n\ncat cat cat');
	await openSearch(page);
	await expect(page.locator(count)).toBeHidden();
	await page.locator('input[name="search"]').pressSequentially('cat');
	await expect(page.locator(count)).toHaveText('0 of 3');
	await page.keyboard.press('Enter');
	await expect(page.locator(count)).toHaveText('1 of 3');
	await page.locator('button[name="next"]').click();
	await expect(page.locator(count)).toHaveText('2 of 3');
	await page.locator('button[name="prev"]').click();
	await page.locator('button[name="prev"]').click();
	await expect(page.locator(count)).toHaveText('3 of 3');
	await page.locator('button[name="next"]').click();
	await expect(page.locator(count)).toHaveText('1 of 3');
});

test('counts matching rules and handles no matches and invalid regex', async ({ page }) => {
	await mountEditor(page, 'Intro\n\ncat CAT catalog');
	await openSearch(page);
	const input = page.locator('input[name="search"]');
	await input.pressSequentially('cat');
	await expect(page.locator(count)).toHaveText('0 of 3');
	await page.locator('label').filter({ has: page.locator('input[name="case"]') }).click();
	await expect(page.locator(count)).toHaveText('0 of 2');
	await page.locator('label').filter({ has: page.locator('input[name="word"]') }).click();
	await expect(page.locator(count)).toHaveText('0 of 1');
	await input.fill('missing');
	await input.press('ArrowRight');
	await expect(page.locator(count)).toHaveText('0 of 0');
	await page.locator('label').filter({ has: page.locator('input[name="re"]') }).click();
	await input.fill('[');
	await input.press('ArrowRight');
	await expect(page.locator(count)).toHaveText('Invalid pattern');
});

test('counts raw source in folded sections and updates after edits', async ({ page }) => {
	const doc = 'Intro\n\n## Section\n\nneedle\nneedle\n\n## Next\n\nneedle';
	await mountEditor(page, doc);
	await page.locator('[data-fold-kind="section"]:visible').first().click();
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await expect(page.locator(count)).toHaveText('0 of 3');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: doc.length, to: doc.length, insert: '\nneedle' }] });
	await expect(page.locator(count)).toHaveText('0 of 4');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 0, head: 0 } });
	await page.locator('button[name="next"]').click();
	await expect(page.locator(count)).toHaveText('1 of 4');
});

test('reopening the panel retains its count and does not duplicate the counter', async ({ page }) => {
	await mountEditor(page, 'Intro\n\nneedle needle');
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await page.keyboard.press('Enter');
	await expect(page.locator(count)).toHaveText('1 of 2');
	await page.keyboard.press('Escape');
	await page.keyboard.press('ControlOrMeta+f');
	await expect(page.locator(count)).toHaveCount(1);
	await expect(page.locator(count)).toHaveText('1 of 2');
});

test('replacement updates the total', async ({ page }) => {
	await mountEditor(page, 'Intro\n\ncat cat');
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('cat');
	await page.locator('.mlp-search-toggle').click();
	await page.locator('input[name="replace"]').pressSequentially('dog');
	await page.locator('button[name="replaceAll"]').click();
	await expect(page.locator(count)).toHaveText('0 of 0');
});

for (const regexp of [false, true]) {
	test(`navigation to an overlapping match has an index (regexp: ${regexp})`, async ({ page }) => {
		await mountEditor(page, 'ababa');
		await openSearch(page);
		await page.locator('input[name="search"]').fill('aba');
		await page.locator('input[name="search"]').press('ArrowRight');
		if (regexp) await page.locator('label').filter({ has: page.locator('input[name="re"]') }).click();
		await postToWebview(page, { type: 'restoreSelection', selection: { anchor: regexp ? 1 : 0, head: regexp ? 1 : 0 } });
		await page.locator(`button[name="${regexp ? 'next' : 'prev'}"]`).click();
		await expect(page.locator(count)).toHaveText('2 of 2');
	});
}
