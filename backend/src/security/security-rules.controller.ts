// 공개 보안 방법론 API(API.md 3.4). 규칙 메타 상수에서 만들어 문서와 코드가 어긋나지 않는다.
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCacheable } from '../common/cache/public-cacheable.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RULE_METAS, RULE_SET_VERSION } from './engine';
import { DISCLAIMER_KO, KNOWN_LIMITS_KO } from './security-copy';

@ApiTags('security')
@Public()
@Controller('security')
export class SecurityRulesController {
  @Get('rules')
  @PublicCacheable('static')
  @ApiOperation({ summary: '위험 신호 규칙 목록과 알려진 상한' })
  rules() {
    return {
      ruleSetVersion: RULE_SET_VERSION,
      disclaimerKo: DISCLAIMER_KO,
      knownLimitsKo: KNOWN_LIMITS_KO,
      rules: RULE_METAS.map((m) => ({
        id: m.id,
        titleKo: m.titleKo,
        descriptionKo: m.descriptionKo,
        severities: m.severities,
        regions: m.regions,
      })),
    };
  }
}
