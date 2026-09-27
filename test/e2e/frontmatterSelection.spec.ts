import { test, expect, type Page, type Locator } from '@playwright/test';
import { mountEditor } from './harness';

const doc = '---\ntitle: Example title\nstatus: draft\n---\n\nBody';

async function dragText(page: Page, element: Locator): Promise<void> {
	const bounds = await element.evaluate(element => {
		const range = document.createRange();
		range.selectNodeContents(element);
		const box = range.getBoundingClientRect();
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	});
	await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 12 });
	await page.mouse.up();
}

for (const cell of ['th', 'td']) {
	test(`dragging a frontmatter ${cell} selects text without revealing source`, async ({ page }) => {
		await mountEditor(page, doc);
		await dragText(page, page.locator(`.mlp-frontmatter ${cell}`).first());
		await expect(page.locator('.mlp-frontmatter')).toBeVisible();
		expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(cell === 'th' ? 'title' : 'Example title');
	});
}

test('a plain click still opens frontmatter source for editing', async ({ page }) => {
	await mountEditor(page, doc);
	await page.locator('.mlp-frontmatter td').first().click();
	await expect(page.locator('.mlp-frontmatter')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: /^title: Example title$/ })).toBeVisible();
});

test('the source button still opens frontmatter source', async ({ page }) => {
	await mountEditor(page, doc);
	await page.locator('.mlp-code-mode-btn').click();
	await expect(page.locator('.mlp-frontmatter')).toHaveCount(0);
});

test('frontmatter error text can be selected', async ({ page }) => {
	await mountEditor(page, '---\ntitle: [\n---\n\nBody');
	const message = page.locator('.mlp-frontmatter-error strong');
	const text = await message.innerText();
	await dragText(page, message);
	await expect(page.locator('.mlp-frontmatter-error')).toBeVisible();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
});

test('dragging frontmatter source keeps YAML visible', async ({ page }) => {
	await mountEditor(page, doc);
	await page.locator('.mlp-code-mode-btn').click();
	await expect(page.locator('.mlp-frontmatter')).toHaveCount(0);
	await dragText(page, page.locator('.cm-line').filter({ hasText: /^title: Example title$/ }));
	await expect(page.locator('.mlp-frontmatter')).toHaveCount(0);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('title: Example title');
});
