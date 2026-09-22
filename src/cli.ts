import readline from 'readline';
import chalk from 'chalk';
import { BrowserManager } from './browser/browser-manager.js';
import { OrchestratorAgent } from './agents/orchestrator.js';
import { config } from './config.js';

function createCli() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const browser = new BrowserManager();

  const agent = new OrchestratorAgent(browser, {
    onAssistantThought(text) {
      if (text.trim()) {
        console.log(`\n${chalk.cyan('🤖 Assistant:')} ${text}`);
      }
    },
    onToolStart(name, input) {
      console.log(`\n${chalk.gray('🔧 Using tool:')} ${chalk.yellow(name)}`);
      console.log(`${chalk.gray('Input:')} ${JSON.stringify(input, null, 2)}`);
    },
    onToolEnd(name, result) {
      console.log(`${chalk.gray('Result:')} ${chalk.green(result)}`);
    },
    onSubAgentStart(query) {
      console.log(`\n${chalk.magenta('🔍 DOM Sub-agent:')} ${chalk.gray('Processing query...')}`);
    },
    onSubAgentEnd(result) {
      console.log(`${chalk.gray('Result:')} ${result}`);
    },
    onSecurityWarning(reason) {
      console.log(`\n${chalk.red.bold('🛡️ [SECURITY WARNING]:')} ${chalk.yellow(reason)}`);
    },
    onFinish(summary, items) {
      console.log(`\n${chalk.cyan.bold('🤖 Assistant:')} ${chalk.white(summary)}`);
      if (items && items.length > 0) {
        console.log(`\n${chalk.bold('**Выполнено:**')}`);
        items.forEach((item) => {
          console.log(`✅ ${item}`);
        });
      }
    },
  });

  console.log(chalk.bold.blue('\n======================================================'));
  console.log(chalk.bold.cyan('  AI-агент для автономной автоматизации браузера'));
  console.log(chalk.gray(`  Модель: ${config.orchestratorModel} (Tool Calling API)`));
  console.log(chalk.bold.blue('======================================================\n'));

  const promptUser = () => {
    rl.question(`\n${chalk.cyan('👤 You:')} `, async (input) => {
      const task = input.trim();
      if (!task) {
        promptUser();
        return;
      }

      if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
        await browser.close();
        rl.close();
        process.exit(0);
      }

      try {
        await agent.run(task);
      } catch (err: any) {
        console.error(chalk.red(`\nОшибка при выполнении: ${err.message}`));
      }

      promptUser();
    });
  };

  // Check if task passed as CLI argument
  const args = process.argv.slice(2);
  const taskArgIndex = args.indexOf('--task');
  if (taskArgIndex !== -1 && args[taskArgIndex + 1]) {
    const task = args[taskArgIndex + 1];
    console.log(`${chalk.cyan('👤 You:')} ${task}`);
    agent
      .run(task)
      .then(async () => {
        if (args.includes('--exit')) {
          await browser.close();
          rl.close();
          process.exit(0);
        } else {
          promptUser();
        }
      })
      .catch(async (err) => {
        console.error(chalk.red(`\nОшибка: ${err.message}`));
        if (args.includes('--exit')) {
          await browser.close();
          rl.close();
          process.exit(1);
        } else {
          promptUser();
        }
      });
  } else {
    promptUser();
  }
}

createCli();
