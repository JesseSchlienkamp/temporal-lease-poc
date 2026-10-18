/**
 * Interactive demo of every test path.
 *
 *   npm run demo                    # menu
 *   npm run demo -- <scenario>      # run one scenario directly, e.g. npm run demo -- esign-outage
 *   npm run demo -- <scenario> --yes   # non-interactive: every prompt takes its default answer
 *   npm run demo -- --list          # list scenario ids
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { bullets, Cancelled, chaosReset, chaosSettings, cmd, preflight, summarize, type DemoContext } from './runtime';
import { runScenario, scenarios, type Scenario } from './scenarios';

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean', short: 'y', default: false }, list: { type: 'boolean', default: false } },
});

function explain(scenario: Scenario) {
  p.note(
    `${bullets(scenario.expect)}\n\n${pc.dim(`Duration: ${scenario.duration} · id: ${scenario.id}`)}`,
    `${pc.bold(scenario.title)} · what to expect`,
  );
}

async function play(ctx: DemoContext, scenario: Scenario) {
  explain(scenario);
  if (!ctx.auto) {
    const go = await p.confirm({ message: 'Run it?', initialValue: true });
    if (p.isCancel(go) || !go) return;
  }
  const result = await runScenario(ctx, scenario);
  await summarize(ctx, result);
}

type MenuChoice = string | 'tool:chaos' | 'tool:chaos-reset' | 'tool:tests' | 'tool:recheck' | 'exit';

async function menu(ctx: DemoContext) {
  let lastGroup = '';
  const options: { value: MenuChoice; label: string; hint?: string; disabled?: boolean }[] = [];
  for (const s of scenarios) {
    if (s.group !== lastGroup) {
      options.push({ value: `group:${s.group}`, label: pc.dim(`── ${s.group} `), disabled: true });
      lastGroup = s.group;
    }
    options.push({ value: s.id, label: s.title, hint: `${s.hint} · ${s.duration}` });
  }
  options.push(
    { value: 'group:tools', label: pc.dim('── Tools '), disabled: true },
    { value: 'tool:chaos', label: 'Show mock service settings', hint: 'failure rates, latency per service' },
    { value: 'tool:chaos-reset', label: 'Reset mock services to defaults' },
    { value: 'tool:tests', label: 'Run the unit tests', hint: 'npm test, mocked activities, time-skipping' },
    { value: 'tool:recheck', label: 'Re-check the local stack' },
    { value: 'exit', label: 'Exit' },
  );

  const choice = await p.select<MenuChoice>({ message: 'Pick a test path', options: options as never, maxItems: 22 });
  if (p.isCancel(choice) || choice === 'exit') return false;

  if (choice === 'tool:chaos') {
    const settings = await chaosSettings();
    const rows = Object.entries(settings).map(
      ([name, c]) =>
        `${name.padEnd(14)} ${pc.dim('failFirstN')} ${String(c.failFirstN).padEnd(3)} ${pc.dim('failureRate')} ${String(c.failureRate).padEnd(4)} ${pc.dim('latency')} ${c.latencyMs} ms`,
    );
    p.note(rows.join('\n'), 'Mock services');
  } else if (choice === 'tool:chaos-reset') {
    await chaosReset();
    p.log.success('Mock services reset to their defaults');
  } else if (choice === 'tool:tests') {
    await new Promise<void>((resolve) =>
      spawn('npm', ['test'], { stdio: 'inherit' }).on('exit', (code) => {
        (code === 0 ? p.log.success : p.log.error)(`npm test exited with ${code}`);
        resolve();
      }),
    );
  } else if (choice === 'tool:recheck') {
    await preflight();
  } else {
    await play(ctx, scenarios.find((s) => s.id === choice)!);
  }
  return true;
}

async function main() {
  if (flags.list) {
    for (const s of scenarios) console.log(`${s.id.padEnd(28)} ${s.title}`);
    return;
  }

  console.clear();
  p.intro(`${pc.bgCyan(pc.black(' Car lease onboarding '))} ${pc.dim('Temporal PoC · test paths')}`);

  const requested = positionals[0] && scenarios.find((s) => s.id === positionals[0]);
  if (positionals[0] && !requested) {
    p.cancel(`Unknown scenario "${positionals[0]}". Try ${cmd('npm run demo -- --list')}`);
    process.exit(1);
  }

  const { client, ok } = await preflight();
  if (!client) {
    p.cancel('Temporal is not reachable. Start it first, then run the demo again.');
    process.exit(1);
  }
  if (!ok) p.log.warn('Some parts of the stack are down; scenarios may stall until you start them.');

  const ctx: DemoContext = { client, auto: flags.yes };
  // Ctrl+C mid-scenario: never leave a mock service switched down.
  process.on('SIGINT', async () => {
    await chaosReset();
    p.cancel('Stopped. Mock services reset to their defaults.');
    process.exit(130);
  });

  try {
    if (requested) {
      await play(ctx, requested);
    } else {
      while (await menu(ctx)) {
        // loop until Exit
      }
    }
    p.outro(pc.dim('Bye. Temporal UI: http://localhost:8233'));
  } catch (err) {
    await chaosReset();
    if (err instanceof Cancelled) {
      p.cancel('Cancelled. Mock services reset to their defaults.');
      return;
    }
    throw err;
  } finally {
    await client.connection.close();
  }
}

main().catch((err) => {
  p.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
