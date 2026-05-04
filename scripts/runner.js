# =============================================================================
# Global Command Runner - مناقصتي
# =============================================================================
# Unified command interface for all development tasks
# Usage: node scripts/runner.js <command> [options]
# =============================================================================

const { spawn, execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const commands = {
    // Quick checks
    'check': {
        desc: 'Run quick validation (TypeScript + ESLint)',
        run: () => runScript('npm run typecheck && npm run lint', { shell: true })
    },
    'check:quick': {
        desc: 'Run quick validation',
        run: () => runScript('npm run check:quick', { shell: true })
    },
    
    // Full checks
    'check:all': {
        desc: 'Run comprehensive validation',
        run: () => runPowerShell('scripts/check-all.ps1')
    },
    'validate': {
        desc: 'Professional validation suite',
        run: () => runPowerShell('scripts/validate-app.ps1')
    },
    
    // Individual checks
    'check:code': {
        desc: 'Code quality (TypeScript, ESLint, Build)',
        run: () => runPowerShell('scripts/checks/code-quality.ps1')
    },
    'check:tests': {
        desc: 'Testing suite (Unit + E2E)',
        run: () => runPowerShell('scripts/checks/tests.ps1')
    },
    'check:security': {
        desc: 'Security audit',
        run: () => runPowerShell('scripts/checks/security.ps1')
    },
    'check:ui': {
        desc: 'UI/UX validation',
        run: () => runPowerShell('scripts/checks/ui-ux.ps1')
    },
    'check:arch': {
        desc: 'Architecture check',
        run: () => runPowerShell('scripts/checks/architecture.ps1')
    },
    
    // Development
    'dev': {
        desc: 'Start development server',
        run: () => runScript('npm run dev')
    },
    'build': {
        desc: 'Production build',
        run: () => runScript('npm run build')
    },
    'lint': {
        desc: 'Run ESLint',
        run: () => runScript('npm run lint')
    },
    'typecheck': {
        desc: 'TypeScript check',
        run: () => runScript('npm run typecheck')
    },
    
    // Testing
    'test': {
        desc: 'Run unit tests',
        run: () => runScript('npm run test')
    },
    'test:watch': {
        desc: 'Watch mode for tests',
        run: () => runScript('npm run test:watch')
    },
    'test:coverage': {
        desc: 'Test coverage report',
        run: () => runScript('npm run test:coverage')
    },
    'e2e': {
        desc: 'Run E2E tests',
        run: () => runScript('npm run e2e')
    },
    'e2e:ui': {
        desc: 'E2E tests with UI',
        run: () => runScript('npm run e2e:ui')
    },
    
    // AI / Genkit
    'genkit:dev': {
        desc: 'Start Genkit dev server',
        run: () => runScript('npm run genkit:dev')
    },
    'genkit:watch': {
        desc: 'Genkit watch mode',
        run: () => runScript('npm run genkit:watch')
    },
    
    // CI
    'ci': {
        desc: 'CI pipeline (typecheck, lint, build, test)',
        run: () => runScript('npm run ci', { shell: true })
    },
    
    // Help
    'help': {
        desc: 'Show this help message',
        run: showHelp
    },
    'list': {
        desc: 'List all available commands',
        run: showCommands
    }
};

function runScript(command, options = {}) {
    try {
        execSync(command, {
            stdio: 'inherit',
            cwd: projectRoot,
            ...options
        });
        return 0;
    } catch (error) {
        console.error(`Error: Command failed with exit code ${error.status}`);
        return error.status || 1;
    }
}

function runPowerShell(scriptPath) {
    try {
        execSync(`powershell -ExecutionPolicy Bypass -File ${scriptPath}`, {
            stdio: 'inherit',
            cwd: projectRoot
        });
        return 0;
    } catch (error) {
        console.error(`Error: Script failed with exit code ${error.status}`);
        return error.status || 1;
    }
}

function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    مناقصتي - Command Runner                        ║
╚═══════════════════════════════════════════════════════════════════╝

Usage: node scripts/runner.js <command> [options]

COMMANDS:
─────────────────────────────────────────────────────────────────────
Quick Validation:
  check              Run quick validation (tsc + lint)
  check:quick        Quick check via PowerShell

Comprehensive:
  check:all         Full check (all tests)
  validate          Professional validation suite

Code Quality:
  check:code        TypeScript, ESLint, Build
  check:security    Security audit
  check:ui          UI/UX validation
  check:arch        Architecture check
  check:tests       Testing suite

Development:
  dev               Start dev server
  build             Production build
  lint              Run ESLint
  typecheck         TypeScript check

Testing:
  test              Run unit tests
  test:watch        Watch mode
  test:coverage     Coverage report
  e2e               Run E2E tests
  e2e:ui            E2E with UI

AI:
  genkit:dev        Start Genkit
  genkit:watch      Watch mode

CI/CD:
  ci                Full CI pipeline

Help:
  help              Show this message
  list              List all commands

EXAMPLES:
─────────────────────────────────────────────────────────────────────
  node scripts/runner.js check:quick
  node scripts/runner.js validate
  node scripts/runner.js dev

Note: PowerShell scripts may require:
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
`);
    return 0;
}

function showCommands() {
    console.log(`
Available Commands:
─────────────────────────────────────────────────────────────────────`);
    const maxLen = Math.max(...Object.keys(commands).map(k => k.length));
    
    for (const [name, cmd] of Object.entries(commands)) {
        const padding = ' '.repeat(maxLen - name.length + 2);
        console.log(`  ${name}${padding}${cmd.desc}`);
    }
    console.log(`
Use 'node scripts/runner.js help' for detailed information.
`);
    return 0;
}

// Main
const args = process.argv.slice(2);
const command = args[0] || 'help';

if (commands[command]) {
    process.exit(commands[command].run());
} else {
    console.error(`Unknown command: ${command}`);
    console.log(`Run 'node scripts/runner.js help' for usage information.`);
    process.exit(1);
}