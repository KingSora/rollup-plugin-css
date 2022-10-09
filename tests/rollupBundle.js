const { rollup } = require('rollup');
const { esbuildResolve } = require('rollup-plugin-esbuild-resolve');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { RollupCss } = require('../dist/index');

module.exports = async (input, options) => {
  const config = {
    input,
    output: {
      dir: 'out',
      assetFileNames: 'assets/[name][extname]',
    },
    plugins: [esbuildResolve(), RollupCss(options)],
  };
  const bundle = await rollup(config);
  const generated = await bundle.write(config.output);
  return generated.output;
};
