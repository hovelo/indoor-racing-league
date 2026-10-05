module.exports = function (eleventyConfig) {
	eleventyConfig.addPassthroughCopy('src/css');
	eleventyConfig.addPassthroughCopy('src/images');
	eleventyConfig.addPassthroughCopy('src/_headers');
	// Self-hosted fonts (latin subset only), referenced from css/style.css.
	const fonts = {
		'barlow-condensed': [700, 800],
		'instrument-sans': [400, 600],
		'jetbrains-mono': [500, 700],
	};
	for (const [family, weights] of Object.entries(fonts)) {
		for (const w of weights) {
			const file = `${family}-latin-${w}-normal.woff2`;
			eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${family}/files/${file}`]: `fonts/${file}` });
		}
	}

	// The cloned private data repo lives under _data but must never be processed as content.
	eleventyConfig.ignores.add('src/_data/league/**');
	eleventyConfig.watchIgnores.add('src/_data/league/.git/**');

	const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	eleventyConfig.addFilter('shortDate', (iso) => longDate.format(new Date(`${iso}T00:00:00Z`)));
	eleventyConfig.addFilter('pad2', (n) => String(n).padStart(2, '0'));
	eleventyConfig.addFilter('percent', (x) => `${Math.round(x * 100)}%`);
	eleventyConfig.addFilter('ordinal', (n) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	});

	return {
		dir: { input: 'src', output: '_site', includes: '_includes', data: '_data' },
		markdownTemplateEngine: 'njk',
		htmlTemplateEngine: 'njk',
	};
};
