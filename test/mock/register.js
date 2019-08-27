require('@babel/register')({
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  plugins: [
    '@babel/plugin-transform-runtime',
  ],
});
require('./index');
