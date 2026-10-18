import { Worker } from '@temporalio/worker';
import * as activities from './activities';
import { config } from './config';
import { getDb } from './db/database';
import { connectWorker } from './temporal-connection';

async function main() {
  getDb(); // create the SQLite file + schema up front
  const connection = await connectWorker();

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log(
    `Worker polling task queue "${config.taskQueue}" on ${config.temporal.address} (namespace ${config.temporal.namespace})`,
  );
  // Shuts down gracefully on SIGINT/SIGTERM (e.g. when Azure Container Apps replaces a revision).
  await worker.run();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
