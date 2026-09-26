import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

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

const CLOSED_BLOCK = 'Intro\n\n```text\nfirst content\nlast content\n```\n\nAfter';

test.describe('fenced code spacing', () => {
	test('inactive fences take no space while source blank lines retain normal height', async ({ page }) => {
		await mountEditor(page, CLOSED_BLOCK);
		const lines = page.locator('.cm-line');
		await expect(lines).toHaveCount(8);
		for (const index of [2, 5]) {
			const fence = lines.nth(index);
			await expect(fence).toHaveClass(/\bmlp-line-code-fence\b/);
			await expect(fence).toHaveCSS('display', 'none');
			await expect.poll(() => fence.evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
		}
		await expect(lines.nth(3)).toBeVisible();
		await expect(lines.nth(4)).toBeVisible();
		await expect.poll(() => lines.evaluateAll((elements) => {
			const boxes = elements.map((el) => el.getBoundingClientRect());
			const normalHeight = parseFloat(getComputedStyle(elements[0]).lineHeight);
			return [
				Math.abs(boxes[1].height - normalHeight),
				Math.abs(boxes[6].height - normalHeight),
				// Each source blank line supplies exactly one line of separation.
				Math.abs(boxes[3].top - boxes[0].bottom - normalHeight),
				Math.abs(boxes[7].top - boxes[4].bottom - normalHeight),
			].every((difference) => difference < 1) && normalHeight > 0;
		})).toBe(true);
	});

	for (const { name, index, pos, source } of [
		{ name: 'opening', index: 2, pos: CLOSED_BLOCK.indexOf('```text'), source: '```text' },
		{ name: 'closing', index: 5, pos: CLOSED_BLOCK.lastIndexOf('```'), source: '```' },
	]) {
		test(`moving the cursor to the ${name} fence reveals it`, async ({ page }) => {
			await mountEditor(page, CLOSED_BLOCK);
			const fence = page.locator('.cm-line').nth(index);
			await expect(fence).toHaveCSS('display', 'none');
			await postToWebview(page, { type: 'setCursor', pos });
			await expect(fence).toBeVisible();
			await expect(fence).toHaveText(source);
			await expect.poll(() => fence.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);

			await postToWebview(page, { type: 'setCursor', pos: 0 });
			await expect(fence).toHaveCSS('display', 'none');
			await expect.poll(() => fence.evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
		});
	}

	test('the source-mode button reveals the opening fence', async ({ page }) => {
		await mountEditor(page, CLOSED_BLOCK);
		const opening = page.locator('.cm-line').nth(2);
		await expect(opening).toHaveCSS('display', 'none');
		await page.locator('.cm-line', { hasText: 'first content' }).hover();
		await page.locator('.mlp-copy-code-host .mlp-code-mode-btn').click();
		await expect(opening).toBeVisible();
		await expect(opening).toHaveText('```text');
		await expect.poll(() => opening.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
		await expect(page.locator('.cm-line', { hasText: 'last content' })).toBeVisible();
	});

	for (const { name, body } of [
		{ name: 'one content line', body: 'last content' },
		{ name: 'multiple content lines', body: 'first content\nlast content' },
		{ name: 'a trailing newline', body: 'first content\nlast content\n' },
	]) {
		test(`an unclosed fence with ${name} keeps its last content visible`, async ({ page }) => {
			await mountEditor(page, `Intro\n\n\`\`\`text\n${body}`);
			const lastContent = page.locator('.cm-line', { hasText: 'last content' });
			await expect(lastContent).toHaveText('last content');
			await expect(lastContent).toBeVisible();
			await expect.poll(() => lastContent.evaluate((el) => {
				// A line box alone is insufficient if the text itself was replaced.
				const range = document.createRange();
				range.selectNodeContents(el);
				const box = range.getBoundingClientRect();
				return box.width > 0 && box.height > 0;
			})).toBe(true);
		});
	}

	for (const opening of ['```', '```text']) {
		test(`an empty block opened with ${opening} is not collapsed`, async ({ page }) => {
			await mountEditor(page, `Intro\n\n${opening}\n\`\`\`\n\nAfter`);
			const lines = page.locator('.cm-line');
			await expect(lines).toHaveCount(6);
			for (const index of [2, 3]) {
				await expect(lines.nth(index)).toBeVisible();
				await expect.poll(() => lines.nth(index).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
			}
			await expect.poll(() => lines.evaluateAll((elements) => {
				const openingBox = elements[2].getBoundingClientRect();
				const closingBox = elements[3].getBoundingClientRect();
				return closingBox.top >= openingBox.bottom - 1;
			})).toBe(true);
		});
	}
});


test.describe('fences sharing a list item line', () => {
	for (const { marker, indent, visibleMarker } of [
		{ marker: '1.', indent: '   ', visibleMarker: '1.' },
		{ marker: '-', indent: '  ', visibleMarker: '•' },
	]) {
		test(`keeps the ${marker} list marker visible`, async ({ page }) => {
			const doc = `Intro\n\n${marker} \`\`\`js\n${indent}const x = 1;\n${indent}\`\`\`\n\nAfter`;
			await mountEditor(page, doc);
			const opening = page.locator('.cm-line').nth(2);
			await expect(opening).toBeVisible();
			await expect(opening).toContainText(visibleMarker);
			await expect(opening).not.toContainText('```');
			await expect(page.locator('.cm-line', { hasText: 'const x = 1;' })).toBeVisible();
		});
	}
});
