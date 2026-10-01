import { test, expect } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const DOC = '# Heading\n\nSome text with a needle in it.\n\n![alt](assets/pic.png)\n';

test.describe('find panel', () => {
	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('Ctrl+F opens it', async ({ page }) => {
		await openSearch(page);
		await expect(page.locator('.cm-search')).toBeVisible();
		await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	});

	test('replace is hidden until the chevron is clicked', async ({ page }) => {
		await openSearch(page);
		const replaceField = page.locator('.cm-search input[name="replace"]');
		await expect(replaceField).toBeHidden();
		await page.locator('.mlp-search-toggle').click();
		await expect(replaceField).toBeVisible();
	});

	test('opening replace does not change the panel width', async ({ page }) => {
		await openSearch(page);
		const panel = page.locator('.cm-search');
		const before = (await panel.boundingBox())!.width;
		await page.locator('.mlp-search-toggle').click();
		await expect(page.locator('.cm-search input[name="replace"]')).toBeVisible();
		const after = (await panel.boundingBox())!.width;
		expect(after).toBeCloseTo(before, 0);
	});

	test('replace always starts on its own line', async ({ page }) => {
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const find = (await page.locator('.mlp-search-row-find').boundingBox())!;
		const replace = (await page.locator('.mlp-search-row-replace').boundingBox())!;
		// The replace row begins below every part of the find row, however the
		// find row itself has wrapped.
		expect(replace.y).toBeGreaterThanOrEqual(find.y + find.height - 1);
	});

	test('rows survive a narrow panel', async ({ page }) => {
		await page.setViewportSize({ width: 420, height: 600 });
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const panel = (await page.locator('.cm-search').boundingBox())!;
		for (const name of ['search', 'replace']) {
			const field = (await page.locator(`.cm-search input[name="${name}"]`).boundingBox())!;
			// Nothing may hang outside the widget, which is what happened when a row
			// was not allowed to wrap.
			expect(field.x).toBeGreaterThanOrEqual(panel.x - 1);
			expect(field.x + field.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
		}
	});

	test('the toggles are readable, not collapsed glyphs', async ({ page }) => {
		await openSearch(page);
		for (const label of ['Aa', '.*']) {
			const glyph = page.locator('.mlp-search-glyph', { hasText: label }).first();
			await expect(glyph).toBeVisible();
			const box = (await glyph.boundingBox())!;
			expect(box.width).toBeGreaterThan(4);
			expect(box.height).toBeGreaterThan(6);
		}
	});

	test('the close button sits on the panel, vertically centered', async ({ page }) => {
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const panel = (await page.locator('.cm-search').boundingBox())!;
		const close = (await page.locator('.cm-search button[name="close"]').boundingBox())!;
		const panelMiddle = panel.y + panel.height / 2;
		const closeMiddle = close.y + close.height / 2;
		expect(Math.abs(closeMiddle - panelMiddle)).toBeLessThanOrEqual(2);
	});

	test('the close button renders its glyph, not a mangled escape', async ({ page }) => {
		await openSearch(page);
		const text = await page.locator('.cm-search button[name="close"]').evaluate((el) => {
			const before = getComputedStyle(el, '::before').content;
			return before;
		});
		expect(text).toContain('×');
		expect(text).not.toContain('d7');
	});

	test('Escape closes it', async ({ page }) => {
		await openSearch(page);
		await page.keyboard.press('Escape');
		await expect(page.locator('.cm-search')).toHaveCount(0);
	});
});

for (const width of [1000, 420]) {
	test(`search options stay together at viewport width ${width}`, async ({ page }) => {
		await page.setViewportSize({ width, height: 600 });
		await mountEditor(page, 'cat catalog bobcat cat');
		await openSearch(page);
		const options = page.locator('.mlp-search-options label');
		await expect(options).toHaveCount(3);
		const bounds = await options.evaluateAll(labels => labels.map(label => {
			const box = label.getBoundingClientRect();
			return { top: box.top, right: box.right };
		}));
		expect(Math.max(...bounds.map(b => b.top)) - Math.min(...bounds.map(b => b.top))).toBeLessThan(1);
		const panel = (await page.locator('.cm-search').boundingBox())!;
		expect(Math.max(...bounds.map(b => b.right))).toBeLessThan(panel.x + panel.width);
		if (width === 1000) {
			const field = (await page.locator('input[name="search"]').boundingBox())!;
			expect(Math.abs(bounds[0].top - field.y)).toBeLessThan(5);
		}
	});
}

test('underlined ab icon toggles whole-word matching', async ({ page }) => {
	await mountEditor(page, 'cat catalog bobcat cat');
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('cat');
	const toggle = page.locator('.mlp-search-options label').filter({ hasText: /^ab$/ });
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute('title', 'Match whole word');
	await expect(toggle.locator('.mlp-search-glyph')).toHaveCSS('text-decoration-line', 'underline');
	await expect(page.locator('.cm-searchMatch, .cm-searchMatch-selected')).toHaveCount(4);
	await toggle.click();
	await expect(toggle.locator('input')).toBeChecked();
	await expect(page.locator('.cm-searchMatch, .cm-searchMatch-selected')).toHaveCount(2);
});

test('navigation uses up/down icons in previous/next order', async ({ page }) => {
	await mountEditor(page, 'Intro\n\nneedle needle');
	await openSearch(page);
	const buttons = page.locator('.mlp-search-navigation button');
	await expect(buttons).toHaveCount(2);
	await expect(buttons.nth(0)).toHaveAttribute('name', 'prev');
	await expect(buttons.nth(1)).toHaveAttribute('name', 'next');
	await expect(buttons.nth(0)).toHaveAccessibleName('previous');
	await expect(buttons.nth(1)).toHaveAccessibleName('next');
	await expect(buttons.nth(0).locator('svg')).toBeVisible();
	await expect(buttons.nth(1).locator('svg')).toBeVisible();
	await expect(buttons).toHaveText(['', '']);
	await page.locator('input[name="search"]').pressSequentially('needle');
	await buttons.nth(1).click();
	await expect(page.locator('.mlp-search-count')).toHaveText('1 of 2');
	await buttons.nth(0).click();
	await expect(page.locator('.mlp-search-count')).toHaveText('2 of 2');
});

test('omits select-all matches while retaining replace-all', async ({ page }) => {
	await mountEditor(page, 'Intro\n\nneedle needle');
	await openSearch(page);
	await expect(page.locator('.cm-search button[name="select"]')).toHaveCount(0);
	await page.locator('.mlp-search-toggle').click();
	await expect(page.locator('button[name="replaceAll"]')).toBeVisible();
});

for (const width of [1000, 420, 320]) {
	test(`query and options share an input frame (${width}px)`, async ({ page }) => {
		await page.setViewportSize({ width, height: 600 });
		await mountEditor(page, 'Intro\n\nneedle needle');
		await openSearch(page);
		await page.locator('input[name="search"]').pressSequentially('needle');
		const frame = (await page.locator('.mlp-search-input').boundingBox())!;
		const input = (await page.locator('input[name="search"]').boundingBox())!;
		const options = (await page.locator('.mlp-search-options').boundingBox())!;
		expect(options.x).toBeGreaterThanOrEqual(input.x + input.width - 1);
		expect(options.x + options.width).toBeLessThanOrEqual(frame.x + frame.width);
		expect(input.width).toBeGreaterThan(25);
		await expect(page.locator('.mlp-search-input .mlp-search-count')).toHaveCount(0);
		await expect(page.locator('.mlp-search-input .mlp-search-navigation')).toHaveCount(0);
		await expect(page.locator('.mlp-search-input label')).toHaveCount(3);
		await page.locator('.mlp-search-toggle').click();
		await expect(page.locator('input[name="replace"]')).toBeVisible();
	});
}

test('focused search uses one outer frame without an inner input outline', async ({ page }) => {
	await mountEditor(page, 'Intro\n\nneedle');
	await openSearch(page);
	const input = page.locator('input[name="search"]');
	await input.focus();
	await expect(input).toHaveCSS('outline-style', 'none');
	await expect(input).toHaveCSS('border-top-width', '0px');
	await expect(page.locator('.mlp-search-input')).toHaveCSS('border-top-color', 'rgb(0, 127, 212)');
});
