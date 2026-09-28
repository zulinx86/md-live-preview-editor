import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const destination = '---\ntitle: Destination\n---\n\n## Decisions\n\n' +
	'Filler paragraph\n\n'.repeat(70) + '## Deliverable\n\n' + 'After\n\n'.repeat(25);

async function expectCenteredHeading(page: Page, text: string): Promise<void> {
	const heading = page.locator('.mlp-line-h2').filter({ hasText: text });
	await expect(heading).toBeInViewport();
	await expect.poll(async () => {
		const box = await heading.boundingBox();
		return box ? Math.abs(box.y + box.height / 2 - page.viewportSize()!.height / 2) : Infinity;
	}).toBeLessThan(60);
}

test('a cross-file link emits its fragment and the destination handles the navigation message', async ({ page, context }) => {
	const href = '../doing/destination.md#deliverable';
	await mountEditor(page, `Intro\n\n[Deliverable](${href})`);
	await page.locator('.mlp-link').click();
	const messages = await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'openLink'));
	expect(messages).toEqual([{ type: 'openLink', href }]);
	const targetPage = await context.newPage();
	await mountEditor(targetPage, destination);
	await postToWebview(targetPage, { type: 'jumpToFragment', fragment: '#deliverable' });
	await expectCenteredHeading(targetPage, 'Deliverable');
});

test('fragment navigation replaces an existing destination selection and scroll position', async ({ page }) => {
	await mountEditor(page, destination);
	await postToWebview(page, { type: 'setCursor', pos: destination.indexOf('## Decisions') });
	await postToWebview(page, { type: 'jumpToFragment', fragment: '#deliverable' });
	await expectCenteredHeading(page, 'Deliverable');
});

test('an encoded destination fragment resolves a Japanese heading', async ({ page }) => {
	await mountEditor(page, destination.replace('## Deliverable', '## 成果'));
	await postToWebview(page, { type: 'jumpToFragment', fragment: '#%E6%88%90%E6%9E%9C' });
	await expectCenteredHeading(page, '成果');
});

test('an empty destination fragment returns to the beginning', async ({ page }) => {
	await mountEditor(page, destination);
	await postToWebview(page, { type: 'jumpToFragment', fragment: '#deliverable' });
	await expectCenteredHeading(page, 'Deliverable');
	await postToWebview(page, { type: 'jumpToFragment', fragment: '#' });
	await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBe(0);
});
