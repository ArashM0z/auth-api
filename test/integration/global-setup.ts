import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

/**
 * One real Redis (the same image production uses) for the whole integration
 * run — identical locally and in CI, no mocks of the system under test.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new RedisContainer('redis:8-alpine').start();
  project.provide('redisUrl', container.getConnectionUrl());
  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    redisUrl: string;
  }
}
