import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  dir: './',
});

const config: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Tool worktrees are whole copies of the repo: their Playwright specs are not
  // Jest's, and their package.json files collide with ours in the module map.
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/e2e/', '<rootDir>/.claude/worktrees/', '<rootDir>/.kilo/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/', '<rootDir>/.kilo/'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
  ],
};

export default createJestConfig(config);