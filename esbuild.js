// Bundles the client and server into standalone CommonJS files under out/,
// so the packaged extension needs no node_modules at runtime.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

const builds = [
  { ...shared, entryPoints: ['client/src/extension.ts'], outfile: 'out/client/extension.js' },
  { ...shared, entryPoints: ['server/src/server.ts'], outfile: 'out/server/server.js' },
];

async function main() {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('watching for changes...');
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
