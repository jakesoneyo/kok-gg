import { Module } from '@nestjs/common';
import { GithubClient, HttpGithubClient } from './github.client';

/** 토큰이 없으면 기동 시점에 실패시킨다 — 무인증 60/h로는 수집이 조용히 망가지기 때문. */
@Module({
  providers: [
    {
      provide: GithubClient,
      useFactory: () => {
        const token = process.env.GITHUB_TOKEN_INGEST;
        if (!token) throw new Error('GITHUB_TOKEN_INGEST가 필요합니다.');
        return new HttpGithubClient({
          token,
          coreReserve: Number(process.env.GITHUB_CORE_RESERVE || 200),
          // 로컬 픽스처 서버(scripts/fake-github-server.ts)나 GHES를 가리킬 때만 설정
          apiBase: process.env.GITHUB_API_BASE,
          rawBase: process.env.GITHUB_RAW_BASE,
        });
      },
    },
  ],
  exports: [GithubClient],
})
export class GithubModule {}
