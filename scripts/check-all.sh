#!/bin/bash
# =============================================================================
# Comprehensive App Check Script - مناقصتي
# =============================================================================
# This script runs all checks on the application:
# - TypeScript type checking
# - ESLint linting
# - Unit tests (Jest)
# - E2E tests (Playwright)
# - Build verification
# - Security checks
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Function to print section header
print_header() {
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

# Function to print status
print_status() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✓ $2${NC}"
  else
    echo -e "${RED}✗ $2${NC}"
  fi
}

# Store start time
START_TIME=$(date +%s)

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          مناقصتي - Comprehensive App Check                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}\n"

# -----------------------------------------------------------------------------
# Step 1: Install dependencies if needed
# -----------------------------------------------------------------------------
print_header "Checking Dependencies"

if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  npm install
  print_status $? "Dependencies installed"
else
  echo -e "${GREEN}Dependencies already installed${NC}"
fi

# -----------------------------------------------------------------------------
# Step 2: TypeScript Type Checking
# -----------------------------------------------------------------------------
print_header "TypeScript Type Checking"

if npm run typecheck; then
  print_status 0 "TypeScript type check passed"
  TYPE_CHECK=0
else
  print_status 1 "TypeScript type check failed"
  TYPE_CHECK=1
fi

# -----------------------------------------------------------------------------
# Step 3: ESLint
# -----------------------------------------------------------------------------
print_header "ESLint Code Quality"

if npm run lint; then
  print_status 0 "ESLint passed"
  LINT=0
else
  print_status 1 "ESLint found issues"
  LINT=1
fi

# -----------------------------------------------------------------------------
# Step 4: Build Verification
# -----------------------------------------------------------------------------
print_header "Production Build"

if npm run build; then
  print_status 0 "Build successful"
  BUILD=0
else
  print_status 1 "Build failed"
  BUILD=1
fi

# -----------------------------------------------------------------------------
# Step 5: Unit Tests
# -----------------------------------------------------------------------------
print_header "Unit Tests (Jest)"

if npm run test -- --passWithNoTests; then
  print_status 0 "Unit tests passed"
  TEST=0
else
  print_status 1 "Unit tests failed"
  TEST=1
fi

# -----------------------------------------------------------------------------
# Step 6: Code Coverage Report
# -----------------------------------------------------------------------------
print_header "Test Coverage"

if npm run test:coverage; then
  print_status 0 "Coverage report generated"
  COVERAGE=0
else
  print_status 1 "Coverage report failed"
  COVERAGE=1
fi

# -----------------------------------------------------------------------------
# Step 7: E2E Tests
# -----------------------------------------------------------------------------
print_header "End-to-End Tests (Playwright)"

# Start dev server in background for E2E tests
npm run dev &
DEV_SERVER_PID=$!

# Wait for server to be ready
echo -e "${YELLOW}Waiting for dev server to be ready...${NC}"
sleep 15

# Run E2E tests
if timeout 180 npm run e2e; then
  print_status 0 "E2E tests passed"
  E2E=0
else
  print_status 1 "E2E tests failed or timed out"
  E2E=1
fi

# Kill dev server
kill $DEV_SERVER_PID 2>/dev/null || true

# -----------------------------------------------------------------------------
# Step 8: Security Audit
# -----------------------------------------------------------------------------
print_header "Security Audit"

if npm audit --audit-level=high; then
  print_status 0 "No high severity vulnerabilities"
  SECURITY=0
else
  print_status 1 "Security vulnerabilities found"
  SECURITY=1
fi

# -----------------------------------------------------------------------------
# Step 9: Firebase Rules Validation
# -----------------------------------------------------------------------------
print_header "Firebase Rules"

if [ -f "firestore.rules" ]; then
  echo -e "${GREEN}Firestore rules file exists${NC}"
  # Note: Requires firebase-tools to validate
  # firebase firestore:rules:validate 2>/dev/null || echo "Skipping Firebase validation"
  FIREBASE_RULES=0
else
  print_status 1 "Firestore rules not found"
  FIREBASE_RULES=1
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
print_header "Summary"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo -e "Total time: ${MINUTES}m ${SECONDS}s"
echo ""

echo -e "┌─────────────────────────┬──────────┐"
echo -e "│ Check                   │ Status   │"
echo -e "├─────────────────────────┼──────────┤"
echo -e "│ TypeScript              │ $([ $TYPE_CHECK -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ ESLint                  │ $([ $LINT -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ Build                   │ $([ $BUILD -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ Unit Tests              │ $([ $TEST -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ Coverage                │ $([ $COVERAGE -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ E2E Tests               │ $([ $E2E -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ Security                │ $([ $SECURITY -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "│ Firebase Rules          │ $([ $FIREBASE_RULES -eq 0 ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")      │"
echo -e "└─────────────────────────┴──────────┘"

# Calculate overall result
TOTAL_FAILURES=$((TYPE_CHECK + LINT + BUILD + TEST + COVERAGE + E2E + SECURITY + FIREBASE_RULES))

if [ $TOTAL_FAILURES -eq 0 ]; then
  echo ""
  echo -e "${GREEN}🎉 All checks passed!${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}⚠️  $TOTAL_FAILURES check(s) failed. Please review the results above.${NC}"
  exit 1
fi