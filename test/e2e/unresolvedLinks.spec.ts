import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('a bracket-only tag stays literal rather than becoming a link', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[design] text\n\nAfter');
	await expect(page.locator('.mlp-link')).toHaveCount(0);
	await expect(page.locator('.cm-line').nth(2)).toHaveText('[design] text');
});

test('a bracket-only tag in a table stays literal', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| Tag |\n|---|\n| [design] |\n\nAfter');
	await expect(page.locator('.mlp-table .mlp-link')).toHaveCount(0);
	await expect(page.locator('.mlp-table td')).toHaveText('[design]');
});

for (const tag of ['[design][]', '[design][missing]', '[**design**]']) {
	test(`unresolved ${tag} preserves its brackets in body and table`, async ({ page }) => {
		await mountEditor(page, `Intro\n\n${tag}\n\n| Tag |\n|---|\n| ${tag} |\n\nAfter`);
		await expect(page.locator('.mlp-link')).toHaveCount(0);
		await expect(page.locator('.mlp-table td')).toHaveText(tag.replaceAll('**', ''));
		if (tag.includes('**')) await expect(page.locator('.mlp-table td strong')).toHaveText('design');
	});
}

test('defined references and inline destinations render in body and table', async ({ page }) => {
	const links = '[full][ref] [ref][] [ref] [inline](https://example.com/inline) [empty]()';
	await mountEditor(page, `Intro\n\n${links}\n\n| Links |\n|---|\n| ${links} |\n\n[ref]: https://example.com/reference "Reference"\n\nAfter`);
	await expect(page.locator('.mlp-link')).toHaveCount(10);
	await expect(page.locator('.mlp-link[data-href="https://example.com/reference"]')).toHaveCount(6);
	await expect(page.locator('.mlp-link[data-href=""]')).toHaveCount(2);
	await expect(page.locator('.mlp-table .mlp-link').first()).toHaveAttribute('title', 'Reference');
});

test('empty link labels do not stop rendering subsequent content', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n[]()\n\n[valid](https://example.com)\n\nAfter');
	await expect(page.locator('.mlp-link')).toHaveText('valid');
});


test('editing a reference definition refreshes an unchanged table', async ({ page }) => {
	const text = 'Intro\n\n| Tag |\n|---|\n| [design] |\n\nAfter\n';
	await mountEditor(page, text);
	await expect(page.locator('.mlp-table .mlp-link')).toHaveCount(0);
	const definition = '\n[design]: https://example.com/first';
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: text.length, to: text.length, insert: definition }] });
	await expect(page.locator('.mlp-table .mlp-link')).toHaveAttribute('data-href', 'https://example.com/first');
	const updated = '\n[design]: https://example.com/second';
	await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from: text.length, to: text.length + definition.length, insert: updated }] });
	await expect(page.locator('.mlp-table .mlp-link')).toHaveAttribute('data-href', 'https://example.com/second');
	await postToWebview(page, { type: 'externalUpdate', version: 3, changes: [{ from: text.length, to: text.length + updated.length, insert: '' }] });
	await expect(page.locator('.mlp-table .mlp-link')).toHaveCount(0);
	await expect(page.locator('.mlp-table td')).toHaveText('[design]');
});
