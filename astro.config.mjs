// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === 'github-pages';

// CloudflareではSSR + Pages Functions、GitHub PagesではLPのみを静的出力する。
export default defineConfig({
  output: isGitHubPagesBuild ? 'static' : 'server',
  adapter: isGitHubPagesBuild ? undefined : cloudflare({
    imageService: 'passthrough',
  }),
  site: isGitHubPagesBuild ? 'https://watanabe3tipapa.github.io' : undefined,
  base: isGitHubPagesBuild ? '/album-pe' : undefined,
});
