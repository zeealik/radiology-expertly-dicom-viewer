const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  moduleNameMapper: {
    '^@ohif/extension-cornerstone$': '<rootDir>/../cornerstone/src/index.tsx',
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
    '^@cornerstonejs/(.*)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/app/**/*.test.js"
  // ]
};
