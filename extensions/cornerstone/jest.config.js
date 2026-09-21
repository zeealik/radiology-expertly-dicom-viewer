const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Sibling extensions resolve under extensions/, not platform/ — this mapping must come
    // first, since the broader `@ohif/(.*)` rule below would otherwise send
    // `@ohif/extension-default/src/...` to a platform path that does not exist.
    '^@ohif/extension-([^/]+)/src/(.*)$': '<rootDir>/../$1/src/$2',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
    '^@cornerstonejs/([^/]+)/(.*)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm/$2',
    '^@cornerstonejs/([^/]+)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/app/**/*.test.js"
  // ]
};
