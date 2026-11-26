// 배치 CLI 진입점: `node dist/cli.js ingest [--as-of YYYY-MM-DD] [--run-id N] [--stages DISCOVER,QUALIFY,…]`
// API 서버와 같은 이미지에서 다른 진입점으로 돈다(ARCHITECTURE 12.1). 종료 코드: 실행 중 FAILED면 1, 다른 실행이 진행 중이라 건너뛰면 0.
import { NestFactory } from '@nestjs/core';
import { parseCliArgs } from './cli-args';
import { CliModule } from './cli.module';
import { IngestionPipeline } from './ingestion/pipeline';

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(CliModule);
  try {
    const pipeline = app.get(IngestionPipeline);
    const out = await pipeline.ingest(opts);
    // run-id 없는 정기 실행 뒤에는 REQUESTED로 남은 수동 실행도 집어 간다
    if (!out.skipped && !opts.runId) await pipeline.drainRequested();
    console.log(JSON.stringify(out));
    process.exitCode = !out.skipped && out.status === 'FAILED' ? 1 : 0;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
