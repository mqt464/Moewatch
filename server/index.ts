import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export { createApiHandler, createServer, type AppOptions } from './app';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { createServer } = await import('./app');
  const port = Number(process.env.MOEWATCH_PORT ?? 3001);
  const host = process.env.MOEWATCH_HOST ?? '127.0.0.1';
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MOEWATCH_PORT');
  createServer().listen(port, host, () => process.stdout.write(`Moewatch API listening on ${host}:${port}\n`));
}
