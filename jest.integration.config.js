module.exports = {
  testMatch: ['<rootDir>/tests/integration/**/*.integration.test.js'],
  testTimeout: 20000,
  maxWorkers: 1,
  forceExit: true,
  coverageDirectory: 'coverage-integration',
  collectCoverageFrom: ['app.js'],
};
