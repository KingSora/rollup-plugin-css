const { rollup } = require('rollup');
const { RollupCss } = require('../dist/index');

module.exports = async (input, options) => {
  const config = {
    input,
    output: {
      dir: 'out',
    },
    plugins: [RollupCss(options)],
  };
  const bundle = await rollup(config);
  const generated = await bundle.write(config.output);
  return generated.output;
};
