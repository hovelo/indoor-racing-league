module.exports = function (eleventyConfig) {
	eleventyConfig.addPassthroughCopy('src/css');
	eleventyConfig.addPassthroughCopy('src/images');
	eleventyConfig.addPassthroughCopy('src/_headers');
	eleventyConfig.addPassthroughCopy({
		'node_modules/@fontsource/pacifico/files/pacifico-latin-400-normal.woff2': 'fonts/pacifico-latin-400-normal.woff2',
	});

	// The cloned private data repo lives under _data but must never be processed as content.
	eleventyConfig.ignores.add('src/_data/league/**');
	eleventyConfig.watchIgnores.add('src/_data/league/.git/**');

	const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	eleventyConfig.addFilter('shortDate', (iso) => longDate.format(new Date(`${iso}T00:00:00Z`)));
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
