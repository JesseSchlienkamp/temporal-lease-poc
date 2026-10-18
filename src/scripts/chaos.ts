/**
 * Switches the mock external services between up and down.
 *
 *   npm run chaos                      # show current settings
 *   npm run chaos -- esign down        # every e-sign call returns 502
 *   npm run chaos -- esign up          # e-sign answers 200 again
 *   npm run chaos -- reset             # back to the default (mildly flaky) settings
 *
 * Services: creditBureau, inventory, esign, notifications, bank.
 */
import { config } from '../config';

async function main() {
  const [service, state] = process.argv.slice(2);
  const url = `${config.mockServicesUrl}/admin/chaos`;

  let res: Response;
  if (!service) {
    res = await fetch(url);
  } else if (service === 'reset') {
    res = await fetch(`${url}/reset`, { method: 'POST' });
  } else if (state === 'down' || state === 'up') {
    // failureRate (not failFirstN): the outage lasts until you switch it back, however often it is called
    const settings = { failureRate: state === 'down' ? 1 : 0, failFirstN: 0 };
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [service]: settings }),
    });
  } else {
    throw new Error('Usage: npm run chaos -- [<service> down|up | reset]');
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(body));
  if (service && service !== 'reset') console.log(`${service} is ${state}`);
  console.table(body);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
