module.exports = {
  root: true,
  extends: [
    require.resolve('@gera2ld/plaid/eslint'),
  ],
  settings: {
    'import/resolver': {
      'babel-module': {},
    },
  },
  rules: {
    'no-continue': 'off',
    'no-cond-assign': ['error', 'except-parens'],
  },
};
