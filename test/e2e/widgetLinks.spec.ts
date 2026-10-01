import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const source of ['[Guide](https://example.com/guide)', 'https://example.com/guide']) {
	test(`plain click opens a table link: ${source}`, async ({ page }) => {
		await mountEditor(page, `Intro\n\n| Link |\n|---|\n| ${source} |\n\nAfter`);
		await page.locator('.mlp-table .mlp-link').click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink')))
			.toEqual([{ type: 'openLink', href: 'https://example.com/guide' }]);
		await expect(page.locator('.mlp-table')).toBeVisible();
	});
}

test('plain click opens a frontmatter URL', async ({ page }) => {
	await mountEditor(page, '---\nsource: https://example.com/guide\n---\n\nBody');
	const value = page.locator('.mlp-frontmatter .mlp-link');
	await value.click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink')))
		.toEqual([{ type: 'openLink', href: 'https://example.com/guide' }]);
});

for (const [value, href] of [
	['"[Guide](./guide.md#details)"', './guide.md#details'],
	['"www.example.com"', 'http://www.example.com'],
	['"user@example.com"', 'mailto:user@example.com'],
	['"<https://example.com/guide>"', 'https://example.com/guide'],
] as const) {
	test(`frontmatter supports link value ${value}`, async ({ page }) => {
		await mountEditor(page, `---\nsource: ${value}\n---\n\nBody`);
		await page.locator('.mlp-frontmatter .mlp-link').click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink')))
			.toEqual([{ type: 'openLink', href }]);
		await expect(page.locator('.mlp-frontmatter')).toBeVisible();
	});
}

test('frontmatter arrays and nested values preserve literal formatting around links', async ({ page }) => {
	await mountEditor(page, '---\ntags: ["*literal*", "https://example.com/one"]\ninfo:\n  site: https://example.com/two\n---\n\nBody');
	await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveCount(2);
	await expect(page.locator('.mlp-frontmatter td').first()).toHaveText('*literal*, https://example.com/one');
	await expect(page.locator('.mlp-frontmatter pre')).toContainText('"site": "https://example.com/two"');
});

test('frontmatter fragments use the existing heading navigation', async ({ page }) => {
	await mountEditor(page, '---\nsource: "[Details](#details)"\n---\n\n## Details\n\nBody');
	await page.locator('.mlp-frontmatter .mlp-link').click();
	await expect(page.locator('.cm-line').filter({ hasText: /## Details/ })).toBeVisible();
	expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink'))).toEqual([]);
});

test('Ctrl/Cmd-click still opens table and frontmatter links', async ({ page }) => {
	await mountEditor(page, '---\nsource: https://example.com/front\n---\n\n| Link |\n|---|\n| [Guide](https://example.com/table) |');
	await page.locator('.mlp-frontmatter .mlp-link').click({ modifiers: ['ControlOrMeta'] });
	await page.locator('.mlp-table .mlp-link').click({ modifiers: ['ControlOrMeta'] });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'openLink'))).toEqual([
		{ type: 'openLink', href: 'https://example.com/front' }, { type: 'openLink', href: 'https://example.com/table' },
	]);
});

test('reference changes refresh frontmatter links', async ({ page }) => {
	const prefix = '---\nsource: "[Docs][ref]"\n---\n\n';
	await mountEditor(page, prefix);
	await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveCount(0);
	const first = '[ref]: https://example.com/one';
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: prefix.length, to: prefix.length, insert: first }] });
	await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveAttribute('data-href', 'https://example.com/one');
	const second = '[ref]: https://example.com/two';
	await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from: prefix.length, to: prefix.length + first.length, insert: second }] });
	await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveAttribute('data-href', 'https://example.com/two');
	await postToWebview(page, { type: 'externalUpdate', version: 3, changes: [{ from: prefix.length, to: prefix.length + second.length, insert: '' }] });
	await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveCount(0);
});

for (const value of ['[id]: docs/file.md', '[id]: <https://example.com>', '`https://example.com`']) {
	test(`frontmatter preserves literal metadata ${value}`, async ({ page }) => {
		await mountEditor(page, `---\nsource: "${value}"\n---\n\nBody`);
		await expect(page.locator('.mlp-frontmatter .mlp-link')).toHaveCount(0);
		await expect(page.locator('.mlp-frontmatter td')).toHaveText(value);
	});
}
