import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

// Keep the initial caret on Intro so every example starts in preview mode.
test.describe('inline code spacing', () => {
	for (const { name, source, rendered, code } of [
		{ name: 'English', source: '`code` follows', rendered: 'code follows', code: 'code' },
		{ name: 'Japanese', source: '`コード` の説明', rendered: 'コード の説明', code: 'コード' },
		{ name: 'double backticks', source: '``a`b`` follows', rendered: 'a`b follows', code: 'a`b' },
		{ name: 'triple backticks', source: '```a``b``` の説明', rendered: 'a``b の説明', code: 'a``b' },
	]) {
		test(`${name}: hidden markers preserve the following space`, async ({ page }) => {
			await mountEditor(page, `Intro\n\n${source}\n\nAfter`);
			const line = page.locator('.cm-line').nth(2);
			await expect(line.locator('code')).toHaveText(code);
			// Do not normalize whitespace: the missing separator is the regression.
			await expect.poll(() => line.textContent()).toBe(rendered);
			await expect(line.locator('code')).toBeVisible();
			// Measure the actual space glyph, not code padding that could disguise
			// its loss. The text outside the code span must occupy horizontal space.
			await expect.poll(() => line.evaluate((el) => {
				const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					if (node.parentElement?.closest('code') || !node.textContent?.startsWith(' ')) continue;
					const range = document.createRange();
					range.setStart(node, 0);
					range.setEnd(node, 1);
					return range.getBoundingClientRect().width;
				}
				return 0;
			})).toBeGreaterThan(0);
		});
	}
});
