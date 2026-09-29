import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const customTheme of [false, true]) {
test(`selection is painted over an opaque code background (custom theme: ${customTheme})`, async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```text\nfirst code line\nsecond code line\n```\n\nAfter');
	await page.addStyleTag({ content: ':root { --vscode-textCodeBlock-background: #202020; --vscode-editor-selectionBackground: #345678; }' });
	if (customTheme) await postToWebview(page, { type: 'applyCss', css: 'pre { background: #202020; color: #eeeeee; }' });
	const line = page.locator('.cm-line').filter({ hasText: /^second code line$/ });
	const pixel = async () => {
		const box = await line.evaluate(element => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				const index = node.textContent?.indexOf('second code line') ?? -1;
				if (index < 0) continue;
				const range = document.createRange();
				range.setStart(node, index + 6);
				range.setEnd(node, index + 7);
				const rect = range.getBoundingClientRect();
				return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
			}
			throw new Error('Code text not found');
		});
		return page.screenshot({ clip: { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2), width: 1, height: 1 } });
	};
	const unselected = await pixel();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await expect(page.locator('.cm-selectionBackground:visible').first()).toBeVisible();
	expect(await pixel()).not.toEqual(unselected);
});
}
