import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const customTheme of [false, true]) {
test(`selection is painted over an opaque code background (custom theme: ${customTheme})`, async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```text\nfirst code line\nsecond code line\n```\n\nAfter');
	await page.addStyleTag({ content: ':root { --vscode-textCodeBlock-background: #202020; --vscode-editor-selectionBackground: #345678; }' });
	if (customTheme) await postToWebview(page, { type: 'applyCss', css: 'pre { background: #202020; color: #eeeeee; }' });
	const line = page.locator('.cm-line').filter({ hasText: /^second code line$/ });
	const pixel = async () => {
		const box = (await line.boundingBox())!;
		return page.screenshot({ clip: { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2), width: 1, height: 1 } });
	};
	const unselected = await pixel();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
	expect(await pixel()).not.toEqual(unselected);
});
}
