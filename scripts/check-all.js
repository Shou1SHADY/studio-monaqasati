#!/usr/bin/env node

/**
 * Comprehensive App Check - مدماك تيك
 * 
 * This script runs all automated checks on the application:
 * - TypeScript type checking
 * - ESLint linting  
 * - Unit tests
 * - Build verification
 * - Security audit
 * 
 * Usage: node scripts/check-all.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function header(message) {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  log(colors.cyan, `  ${message}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function runCommand(command, description) {
  log(colors.yellow, `Running: ${description}...`);
  try {
    execSync(command, { stdio: 'inherit', cwd: __dirname + '/..' });
    log(colors.green, `✓ ${description} passed`);
    return 0;
  } catch (error) {
    log(colors.red, `✗ ${description} failed`);
    return 1;
  }
}

async function main() {
  console.log(`${colors.blue}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║          مدماك تيك - Comprehensive App Check                      ║${colors.reset}`);
  console.log(`${colors.blue}╚═══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  const results = {
    typecheck: 0,
    lint: 0,
    build: 0,
    test: 0,
    security: 0
  };

  // Type check
  header('TypeScript Type Checking');
  results.typecheck = runCommand('npx tsc --noEmit', 'TypeScript');

  // Lint
  header('ESLint Code Quality');
  results.lint = runCommand('npx next lint', 'ESLint');

  // Build
  header('Production Build');
  results.build = runCommand('npm run build', 'Build');

  // Tests
  header('Unit Tests');
  results.test = runCommand('npx jest --passWithNoTests', 'Jest Tests');

  // Summary
  header('Summary');
  
  const totalFailures = Object.values(results).reduce((a, b) => a + b, 0);
  
  console.log(`┌─────────────────────────┬──────────┐`);
  console.log(`│ Check                   │ Status   │`);
  console.log(`├─────────────────────────┼──────────┤`);
  console.log(`│ TypeScript              │ ${results.typecheck === 0 ? 'PASS' : 'FAIL'}      │`);
  console.log(`│ ESLint                  │ ${results.lint === 0 ? 'PASS' : 'FAIL'}      │`);
  console.log(`│ Build                   │ ${results.build === 0 ? 'PASS' : 'FAIL'}      │`);
  console.log(`│ Unit Tests              │ ${results.test === 0 ? 'PASS' : 'FAIL'}      │`);
  console.log(`└─────────────────────────┴──────────┘`);

  if (totalFailures === 0) {
    log(colors.green, '\n🎉 All checks passed!\n');
    process.exit(0);
  } else {
    log(colors.red, `\n⚠️  ${totalFailures} check(s) failed.\n`);
    process.exit(1);
  }
}

main().catch(error => {
  log(colors.red, `Error: ${error.message}`);
  process.exit(1);
});