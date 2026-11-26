// e2e 전체가 Testcontainers DB 1개를 공유한다(컨테이너 기동·마이그레이션이 느려 스위트마다 띄우지 않음).
// jest --runInBand라 여기서 설정한 process.env가 각 스위트에 그대로 보인다.
import { startKokDb, type KokDb } from './kok-db';

declare global {
  var __KOK_DB__: KokDb | undefined;
}

export default async function globalSetup(): Promise<void> {
  const db = await startKokDb();
  globalThis.__KOK_DB__ = db;
  process.env.DATABASE_URL = db.url('kok_app');
  process.env.AI_DATABASE_URL = db.url('kok_ai');
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.NODE_ENV = 'test';
  // 전역 한도(120/분)는 대량 순회 테스트를 막으므로 끄고, 한도 자체는 IT-15 스위트가 따로 검증한다.
  process.env.THROTTLE_DEFAULT_LIMIT = '100000';
}
