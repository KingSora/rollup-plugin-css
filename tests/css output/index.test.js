const path = require('path');
const rollupBundle = require('../rollupBundle');

test('resolve path alias', async () => {
  const output = await rollupBundle(path.resolve(__dirname, './bundle/input.js'));
  console.log(output);
});
