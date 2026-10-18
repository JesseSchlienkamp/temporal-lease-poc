// Agent inbox served at GET /agent. Plain HTML + JS, no build step. Polls /agent/tasks and
// submits through /agent/tasks/:workflowId/payment-details.

export const agentPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent inbox · Car lease onboarding</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #fff; --text: #1d2330; --muted: #5d6676; --line: #dfe3ea;
    --accent: #1f5eff; --warn-bg: #fff6e5; --warn: #8a5300; --err-bg: #fdecec; --err: #a12020;
    --ok-bg: #e8f6ee; --ok: #19663a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-size: 15px; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; }
  .empty { background: var(--card); border: 1px dashed var(--line); border-radius: 10px; padding: 32px; text-align: center; color: var(--muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--err-bg); color: var(--err); margin-left: 8px; vertical-align: 2px; }
  .reason { background: var(--warn-bg); color: var(--warn); border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; font-size: 14px; }
  form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; }
  label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
  input { font: inherit; padding: 9px 10px; border: 1px solid var(--line); border-radius: 7px; color: var(--text); }
  input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent); border-color: var(--accent); }
  input[name=iban] { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
  button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 7px; background: var(--accent); color: #fff; cursor: pointer; }
  button:disabled { opacity: .55; cursor: progress; }
  .result { margin-top: 12px; font-size: 14px; border-radius: 8px; padding: 10px 12px; }
  .result.error { background: var(--err-bg); color: var(--err); }
  .result.ok { background: var(--ok-bg); color: var(--ok); }
  details { margin-top: 28px; color: var(--muted); font-size: 13px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  @media (max-width: 620px) { form { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>Agent inbox</h1>
    <span class="sub" id="status">Loading…</span>
  </header>
  <div id="tasks"></div>
  <div id="done"></div>
  <details>
    <summary>Demo IBANs (mock bank)</summary>
    <p><code>NL91 ABNA 0417 1643 00</code> J. Jansen: matches the default demo customer<br>
       <code>NL20 INGB 0001 2345 67</code> P. de Vries: registered to someone else<br>
       <code>NL44 RABO 0123 4567 89</code> J. Jansen: account closed<br>
       <code>NL51 ABNA 0987 6543 21</code> P. Bakker<br>
       <code>NL36 INGB 0007 6543 21</code> valid checksum, unknown to the bank<br>
       <code>NL00 ABNA 0417 1643 00</code> invalid checksum: rejected before it reaches the workflow</p>
  </details>
</main>
<script>
  const tasksEl = document.getElementById('tasks');
  const doneEl = document.getElementById('done');
  const statusEl = document.getElementById('status');
  const cards = new Map(); // workflowId -> { el, reasonEl, badgeEl }

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  }

  function badgeText(task) {
    return task.rejectedSubmissions ? task.rejectedSubmissions + ' rejected' : '';
  }

  function createCard(task) {
    const reasonEl = el('div', { className: 'reason', textContent: task.reason });
    const badgeEl = el('span', { className: 'badge', textContent: badgeText(task) });
    badgeEl.hidden = !task.rejectedSubmissions;
    const resultEl = el('div', { className: 'result' });
    resultEl.hidden = true;

    const iban = el('input', { name: 'iban', required: true, placeholder: 'NL91 ABNA 0417 1643 00', value: task.prefill.iban ?? '' });
    const holder = el('input', { name: 'accountHolder', required: true, value: task.prefill.accountHolder });
    const button = el('button', { type: 'submit', textContent: 'Submit' });
    const form = el('form', {}, [
      el('label', {}, ['IBAN', iban]),
      el('label', {}, ['Account holder', holder]),
      button,
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      button.textContent = 'Verifying…';
      resultEl.hidden = true;
      try {
        const res = await fetch('/agent/tasks/' + encodeURIComponent(task.workflowId) + '/payment-details', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ iban: iban.value, accountHolder: holder.value }),
        });
        const body = await res.json();
        if (body.accepted) {
          card.remove();
          cards.delete(task.workflowId);
          doneEl.prepend(el('div', { className: 'result ok', textContent:
            '✓ ' + task.customerName + ': mandate ' + body.mandate.mandateReference + ' created. Contract goes out for signature.' }));
          refresh();
          return;
        }
        resultEl.className = 'result error';
        resultEl.textContent = (res.status === 422 ? 'Not accepted: ' : 'Rejected, the form is reopened: ') + body.reason;
        resultEl.hidden = false;
        if (body.rejectedSubmissions) {
          badgeEl.textContent = body.rejectedSubmissions + ' rejected';
          badgeEl.hidden = false;
          reasonEl.textContent = body.reason;
        }
      } catch (err) {
        resultEl.className = 'result error';
        resultEl.textContent = 'Request failed: ' + err.message;
        resultEl.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = 'Submit';
      }
    });

    const card = el('section', { className: 'card' }, [
      el('h2', {}, ['Collect IBAN for ' + task.customerName, badgeEl]),
      el('div', { className: 'meta', textContent: task.workflowId + ' · opened ' + new Date(task.openedAt).toLocaleString() }),
      reasonEl,
      form,
      resultEl,
    ]);
    return { el: card, reasonEl, badgeEl };
  }

  async function refresh() {
    try {
      const tasks = await (await fetch('/agent/tasks')).json();
      const seen = new Set();
      for (const task of tasks) {
        seen.add(task.workflowId);
        let card = cards.get(task.workflowId);
        if (!card) {
          card = createCard(task);
          cards.set(task.workflowId, card);
          tasksEl.append(card.el);
        } else {
          // Update the text only; never touch inputs the agent may be typing in.
          card.reasonEl.textContent = task.reason;
          card.badgeEl.textContent = badgeText(task);
          card.badgeEl.hidden = !task.rejectedSubmissions;
        }
      }
      for (const [id, card] of cards) {
        if (!seen.has(id)) { card.el.remove(); cards.delete(id); }
      }
      tasksEl.querySelector('.empty')?.remove();
      if (!cards.size) tasksEl.append(el('div', { className: 'empty', textContent: 'No open tasks. Start a lead without an IBAN to create one.' }));
      statusEl.textContent = cards.size + ' open · updated ' + new Date().toLocaleTimeString();
    } catch (err) {
      statusEl.textContent = 'Could not load tasks: ' + err.message;
    }
  }

  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>
`;
