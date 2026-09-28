import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('restores an offscreen source cursor at its UTF-16 position', async ({ page }) => {
	const doc = 'Intro\n\n' + 'Filler line\n'.repeat(70) + 'Target 📚 notes\n' + 'After\n'.repeat(25);
	const offset = doc.indexOf('📚') + 2;
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: offset, head: offset } });
	await expect(page.locator('.cm-cursor').first()).toBeInViewport();
	await postToWebview(page, { type: 'requestSelection', requestId: 1 });
	const response = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'selection'));
	expect(response).toEqual({ type: 'selection', requestId: 1, selection: { anchor: offset, head: offset } });
});

test('preserves the direction and endpoints of a source selection', async ({ page }) => {
	const doc = 'Intro\n\n📚 notes and text';
	const selection = { anchor: doc.indexOf(' and'), head: doc.indexOf('📚') };
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'restoreSelection', selection });
	await postToWebview(page, { type: 'requestSelection', requestId: 2 });
	const response = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'selection'));
	expect(response).toEqual({ type: 'selection', requestId: 2, selection });
});

test('flushes recent typing before returning the preview cursor', async ({ page }) => {
	await mountEditor(page, 'Hello');
	await postToWebview(page, { type: 'restoreSelection', selection: { anchor: 5, head: 5 } });
	await page.keyboard.type(' world');
	await postToWebview(page, { type: 'requestSelection', requestId: 3 });
	const messages = await page.evaluate(() => (window as any).__posted.filter((message: any) => ['edit', 'selection'].includes(message.type)));
	expect(messages.at(-1)).toEqual({ type: 'selection', requestId: 3, selection: { anchor: 11, head: 11 } });
	expect(messages.slice(0, -1).flatMap((message: any) => message.changes).map((change: any) => change.insert).join('')).toBe(' world');
});
