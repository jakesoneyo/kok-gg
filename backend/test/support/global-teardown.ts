export default async function globalTeardown(): Promise<void> {
  await globalThis.__KOK_DB__?.stop();
}
