const rollup = require('rollup');
const { getRollupPlugins, getExternal, DIST } = require('./scripts/util');
const pkg = require('./package.json');

const FILENAME = 'index';
const BANNER = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} License */`;

const external = getExternal(['jszip']);
const rollupConfig = [
  {
    input: {
      input: 'src/index.js',
      plugins: getRollupPlugins(),
      external,
    },
    output: {
      format: 'cjs',
      file: `${DIST}/${FILENAME}.common.js`,
    },
  },
  {
    input: {
      input: 'src/index.js',
      plugins: getRollupPlugins(),
      external,
    },
    output: {
      format: 'esm',
      file: `${DIST}/${FILENAME}.esm.js`,
    },
  },
  {
    input: {
      input: 'src/index.js',
      plugins: getRollupPlugins({ browser: true }),
      external,
    },
    output: {
      format: 'umd',
      file: `${DIST}/${FILENAME}.umd.js`,
      name: 'JarParser',
      globals: {
        jszip: 'JSZip',
      },
    },
  },
];

rollupConfig.forEach((item) => {
  item.output = {
    indent: false,
    ...item.output,
    ...BANNER && {
      banner: BANNER,
    },
  };
});

module.exports = rollupConfig.map(({ input, output }) => ({
  ...input,
  output,
}));
