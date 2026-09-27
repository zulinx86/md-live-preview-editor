import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

for (const width of [500, 1000]) {
	for (const list of [false, true]) {
		test(`multiline selection stays within the text column (${width}px, ${list ? 'list' : 'paragraph'})`, async ({ page }) => {
			await page.setViewportSize({ width, height: 700 });
			const doc = list ? '- First item\n  - Nested item\n  - Last item' : 'First line\n' + 'wrapped text '.repeat(30) + '\nThird line';
			await mountEditor(page, doc);
			await page.locator('.cm-content').click();
			await page.keyboard.press('ControlOrMeta+a');
			await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
			const geometry = await page.evaluate(() => {
				const line = document.querySelector('.cm-line')!;
				const range = document.createRange();
				range.selectNodeContents(line);
				return {
					textLeft: range.getBoundingClientRect().left,
					scrollerWidth: document.querySelector('.cm-scroller')!.clientWidth,
					scrollWidth: document.querySelector('.cm-scroller')!.scrollWidth,
					selectionLeft: Math.min(...Array.from(document.querySelectorAll('.cm-selectionBackground'), element => element.getBoundingClientRect().left)),
				};
			});
			expect(geometry.selectionLeft).toBeGreaterThanOrEqual(geometry.textLeft - 1);
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.scrollerWidth + 1);
		});
	}
}
