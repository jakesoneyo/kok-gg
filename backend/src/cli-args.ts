// CLI 인자 해석(순수). 부트스트랩과 분리해 Nest 없이 테스트한다.
import { StageName } from '@prisma/client';
import { parseArgs } from 'node:util';

export function parseCliArgs(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'as-of': { type: 'string' },
      'run-id': { type: 'string' },
      stages: { type: 'string' },
    },
  });
  if (positionals[0] !== 'ingest')
    throw new Error('사용법: cli ingest [--as-of] [--run-id] [--stages]');
  const asOf = values['as-of'];
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    throw new Error('--as-of는 YYYY-MM-DD');
  const stages = values.stages
    ? values.stages.split(',').map((s) => {
        if (!(s in StageName)) throw new Error(`알 수 없는 단계: ${s}`);
        return s as StageName;
      })
    : undefined;
  return {
    asOf,
    runId: values['run-id'] ? Number(values['run-id']) : undefined,
    stages,
  };
}
