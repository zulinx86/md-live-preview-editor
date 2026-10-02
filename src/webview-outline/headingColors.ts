import { adaptMarkdownCss } from '../shared/cssAdapter';

/** Sample heading colors with the editor's CSS without styling the outline itself. */
export class HeadingColors {
	private readonly sampleBody: HTMLElement;
	private readonly customStyle: HTMLStyleElement;
	private readonly headings: HTMLElement[];
	private css: string | undefined;

	constructor(private readonly root: HTMLElement, themeUri?: string) {
		const host = document.createElement('div');
		host.hidden = true;
		document.body.appendChild(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const html = document.createElement('html');
		html.className = 'mlp-color-root';
		this.sampleBody = document.createElement('body');
		html.appendChild(this.sampleBody);
		shadow.appendChild(html);
		if (themeUri) {
			const base = document.createElement('link');
			base.rel = 'stylesheet';
			base.href = themeUri;
			base.addEventListener('load', () => this.refresh());
			shadow.prepend(base);
		}
		this.customStyle = document.createElement('style');
		shadow.appendChild(this.customStyle);
		const documentRoot = this.sampleBody.appendChild(document.createElement('div'));
		documentRoot.id = 'mlp-root';
		const editor = documentRoot.appendChild(document.createElement('div'));
		editor.className = 'cm-editor';
		editor.style.color = 'var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc))';
		const scroller = editor.appendChild(document.createElement('div'));
		scroller.className = 'cm-scroller';
		const content = scroller.appendChild(document.createElement('div'));
		content.className = 'cm-content';
		this.headings = Array.from({ length: 6 }, (_, i) => {
			const heading = content.appendChild(document.createElement('div'));
			heading.className = `cm-line mlp-line-h${i + 1}`;
			return heading;
		});
		// VS Code changes body classes and CSS variables when its theme changes.
		new MutationObserver(() => this.refresh()).observe(document.body, { attributes: true });
	}

	/** Apply the active Markdown CSS and update the six outline color variables. */
	update(css: string): void {
		if (css !== this.css) {
			this.css = css;
			this.customStyle.textContent = adaptMarkdownCss(css);
			// A shadow tree has no :root. A class preserves its specificity,
			// preserving custom properties and media rules via the browser's CSSOM.
			const mapRoot = (rules: CSSRuleList) => {
				for (const rule of Array.from(rules)) {
					if (rule instanceof CSSStyleRule) rule.selectorText = rule.selectorText.replace(/:root\b/g, '.mlp-color-root');
					if ('cssRules' in rule) mapRoot((rule as CSSGroupingRule).cssRules);
				}
			};
			if (this.customStyle.sheet) mapRoot(this.customStyle.sheet.cssRules);
		}
		this.refresh();
	}

	private refresh(): void {
		for (const attribute of Array.from(this.sampleBody.attributes)) {
			if (!document.body.hasAttribute(attribute.name)) this.sampleBody.removeAttribute(attribute.name);
		}
		for (const attribute of Array.from(document.body.attributes)) {
			this.sampleBody.setAttribute(attribute.name, attribute.value);
		}
		this.headings.forEach((heading, i) => {
			this.root.style.setProperty(`--mlp-outline-h${i + 1}`, getComputedStyle(heading).color);
		});
	}
}
