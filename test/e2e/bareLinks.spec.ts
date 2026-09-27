import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

test('a bare URL in a list is rendered and opens on click', async ({ page }) => {
	const href = 'https://example.com/docs/concepts/#integrations';
	await mountEditor(page, `Intro\n\n- ${href}\n\nAfter`);
	const link = page.locator('.mlp-link');
	await expect(link).toHaveText(href);
	await expect(link).toHaveAttribute('data-href', href);
	await link.click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'openLink'))).toEqual([{ type: 'openLink', href }]);
});

for (const source of ['https://example.com/a?x=1#part', '<https://example.com/a>', 'www.example.com', 'user@example.com']) {
	for (const table of [false, true]) {
		test(`${source} opens with the correct destination in ${table ? 'table' : 'body'}`, async ({ page }) => {
			const label = source.replace(/^<|>$/g, '');
			const href = label.startsWith('www.') ? `http://${label}` : label.includes('@') ? `mailto:${label}` : label;
			const content = table ? `| Link |\n|---|\n| ${source} |` : source;
			await mountEditor(page, `Intro\n\n${content}\n\nAfter`);
			const link = page.locator('.mlp-link');
			await expect(link).toHaveText(label);
			// Tables reserve a plain click for editing the cell.
			await link.click({ modifiers: table ? ['ControlOrMeta'] : [] });
			await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'openLink'))).toEqual([{ type: 'openLink', href }]);
		});
	}
}

test('code and reference definitions do not create clickable bare URLs', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n`https://example.com/inline`\n\n```text\nhttps://example.com/fenced\n```\n\n[ref]: https://example.com/definition\n\nAfter');
	await expect(page.locator('.mlp-link')).toHaveCount(0);
});

test('sentence punctuation is excluded from a bare link destination', async ({ page }) => {
	await mountEditor(page, 'Intro\n\nSee https://example.com/path.\n\nAfter');
	await expect(page.locator('.mlp-link')).toHaveText('https://example.com/path');
	await expect(page.locator('.mlp-link')).toHaveAttribute('data-href', 'https://example.com/path');
});
