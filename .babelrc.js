module.exports = {
  extends: require.resolve('@gera2ld/plaid/config/babelrc-base'),
  presets: [
  ],
  plugins: [

    process.env.BABEL_ENV === 'test' && 'istanbul',
  ].filter(Boolean),
};
