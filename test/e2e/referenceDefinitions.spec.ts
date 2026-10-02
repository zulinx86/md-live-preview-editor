import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview, openSearch } from './harness';

test('reference definitions are hidden while their links still work', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[Guide][guide]\n\n[guide]:\n  https://example.com/guide\n  "Guide title"\n[other]: https://example.com/other\n\nAfter');
	await expect(page.locator('.mlp-link')).toHaveAttribute('data-href', 'https://example.com/guide');
	await expect(page.locator('.cm-content')).not.toContainText('[guide]:');
	await expect(page.locator('.cm-content')).not.toContainText('https://example.com/guide');
	await expect(page.locator('.cm-content')).not.toContainText('[other]:');
	await expect(page.locator('.cm-content')).toContainText('After');
});

test('jumping to a definition reveals editable source and leaving hides it', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[Guide][ref]\n\n[ref]:\n  https://example.com/guide\n  "Title"\n\nAfter');
	await postToWebview(page, { type: 'jumpToLine', line: 6 });
	await expect(page.locator('.cm-content')).toContainText('[ref]:');
	await expect(page.locator('.cm-content')).toContainText('https://example.com/guide');
	await page.keyboard.press('End');
	await page.keyboard.type('/updated');
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await expect(page.locator('.cm-content')).not.toContainText('[ref]:');
	await expect(page.locator('.mlp-link')).toHaveAttribute('data-href', 'https://example.com/guide/updated');
});

test('search reveals a match in a hidden definition', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[ref]: https://example.com/unique-destination\n\nAfter');
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('unique-destination');
	await page.locator('input[name="search"]').press('Enter');
	await expect(page.locator('.cm-content')).toContainText('[ref]: https://example.com/unique-destination');
});

test('definition-like text in code and undefined brackets stay visible', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```text\n[code]: https://example.com/code\n```\n\n[undefined]\n\n[invalid]:\n\nAfter');
	await expect(page.locator('.cm-content')).toContainText('[code]: https://example.com/code');
	await expect(page.locator('.cm-content')).toContainText('[undefined]');
	await expect(page.locator('.cm-content')).toContainText('[invalid]:');
});

for (const action of ['click', 'keyboard']) {
	test(`one hidden-lines marker reveals neighboring definitions by ${action}`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[first]: https://example.com/first\n\n[second]:\n  https://example.com/second\n\nAfter');
		const marker = page.locator('.mlp-reference-definitions-toggle');
		await expect(marker).toHaveCount(1);
		await expect(marker).toHaveAttribute('aria-label', 'Show reference definitions (4 hidden lines)');
		if (action === 'click') await marker.click();
		else { await marker.focus(); await marker.press('Enter'); }
		await expect(marker).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('[first]:');
		await expect(page.locator('.cm-content')).toContainText('[second]:');
		await postToWebview(page, { type: 'jumpToLine', line: 1 });
		await expect(marker).toHaveCount(1);
		await expect(page.locator('.cm-content')).not.toContainText('[second]:');
	});
}

test('visible paragraphs separate definition groups', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[first]: /first\n\nMiddle\n\n[second]: /second\n\nAfter');
	await expect(page.locator('.mlp-reference-definitions-toggle')).toHaveCount(2);
	await expect(page.locator('.cm-content')).toContainText('Middle');
});

test('external edits move the marker reveal position', async ({ page }) => {
	const text = 'Intro\n\n[ref]: /target\n\nAfter';
	await mountEditor(page, text);
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 0, insert: 'Added paragraph\n\n' }] });
	await page.locator('.mlp-reference-definitions-toggle').click();
	await expect(page.locator('.cm-content')).toContainText('[ref]: /target');
	await page.keyboard.type('X');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').flatMap((m: any) => m.changes)))
		.toContainEqual(expect.objectContaining({ from: 'Added paragraph\n\nIntro\n\n'.length, insert: 'X' }));
});

test('neighboring definitions inside one blockquote share a marker', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [first]: /first\n> [second]: /second\n\nAfter');
	const marker = page.locator('.mlp-reference-definitions-toggle');
	await expect(marker).toHaveCount(1);
	await marker.click();
	await expect(page.locator('.cm-content')).toContainText('[first]:');
	await expect(page.locator('.cm-content')).toContainText('[second]:');
});


test('hidden-lines control aligns with section arrows in the folding gutter', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n## Section\n\nBody\n\n[ref]: /target\n\nAfter');
	const marker = page.locator('.mlp-reference-definitions-toggle');
	await expect(page.locator('.cm-content button.mlp-reference-definitions-toggle')).toHaveCount(0);
	await expect(page.locator('.mlp-section-fold-gutter .mlp-reference-definitions-toggle')).toHaveCount(1);
	const referenceBox = (await marker.boundingBox())!;
	const sectionBox = (await page.locator('[data-fold-kind="section"]:visible').last().boundingBox())!;
	expect(referenceBox.x + referenceBox.width / 2).toBeCloseTo(sectionBox.x + sectionBox.width / 2, 1);
	await marker.click();
	await expect(page.locator('.cm-content')).toContainText('[ref]: /target');
});
