import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfiguredModelRouter, OpenRouterProvider } from '@nox/ai';
import { OpenRouterEmbeddingProvider } from '@nox/embeddings';
import { createPostgresRepositories } from '@nox/database';
import {
  InMemoryLongTermMemoryRepository,
  ModelMemoryClassifier,
  SemanticMemorySearch,
} from '@nox/memory';
import { loadEnv } from '@nox/shared';
import { InMemoryAIUsageRepository } from '@nox/usage';

const env = loadEnv();
const text =
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
  'Foi mencionado que Fulano bateu o carro ontem, mas está bem.';
const query =
  process.argv.find((argument) => argument.startsWith('--query='))?.slice('--query='.length) ??
  'O que aconteceu com Fulano?';
const openRouterOptions = {
  apiKey: env.OPENROUTER_API_KEY,
  baseUrl: env.OPENROUTER_BASE_URL,
  appName: env.OPENROUTER_APP_NAME,
  ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
};
const router = new ConfiguredModelRouter({
  DEFAULT: env.MODEL_DEFAULT ?? env.OPENROUTER_MODEL,
  MEMORY: env.MODEL_MEMORY ?? env.MODEL_FAST ?? env.MODEL_DEFAULT ?? env.OPENROUTER_MODEL,
  EMBEDDING: env.MODEL_EMBEDDING,
});
const provider = new OpenRouterProvider(openRouterOptions);
const embeddings = new OpenRouterEmbeddingProvider({ ...openRouterOptions, dimensions: 1536 });
const classifier = new ModelMemoryClassifier({ provider, router, reasoningEffort: 'none' });
const postgresRepositories = process.argv.includes('--postgres')
  ? createPostgresRepositories(
      env.DATABASE_URL ??
        (() => {
          throw new Error('DATABASE_URL is required with --postgres');
        })(),
      env.CONFIRMATION_TTL_SECONDS * 1_000,
    )
  : undefined;
const repository = postgresRepositories?.longTermMemory ?? new InMemoryLongTermMemoryRepository();
const usage = new InMemoryAIUsageRepository();

const classified = await classifier.classify({ transcript: text });
if (classified.classification.decision !== 'KEEP' || !classified.classification.type) {
  console.log(JSON.stringify({ classification: classified.classification }, null, 2));
  await postgresRepositories?.close();
  process.exitCode = 2;
} else {
  const embedded = await embeddings.embed({
    model: env.MODEL_EMBEDDING,
    text: classified.classification.content,
  });
  const created = await repository.createLongTermMemory({
    userId: env.NOX_USER_ID,
    deviceId: env.NOX_DEVICE_ID,
    type: classified.classification.type,
    content: classified.classification.content,
    importance: classified.classification.importance,
    confidence: classified.classification.confidence,
    source: 'eko',
    sourceTimestamp: new Date(),
    embedding: embedded.embedding,
    embeddingModel: embedded.usage.model,
    metadata: { verification: true, speakerIdentity: 'unknown' },
  });
  try {
    const search = new SemanticMemorySearch({
      repository,
      embeddings,
      embeddingModel: env.MODEL_EMBEDDING,
      usage,
    });
    const results = await search.search({
      query,
      userId: env.NOX_USER_ID,
      deviceId: env.NOX_DEVICE_ID,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      limit: 3,
    });
    console.log(
      JSON.stringify(
        {
          storage: postgresRepositories ? 'postgres-pgvector' : 'in-memory',
          classification: classified.classification,
          embedding: {
            model: embedded.usage.model,
            dimensions: embedded.embedding.length,
            tokens: embedded.usage.totalTokens,
            cost: embedded.usage.cost,
          },
          retrieval: results.map((memory) => ({
            content: memory.content,
            similarity: memory.similarity,
            score: memory.score,
            source: memory.source,
            confidence: memory.confidence,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    if (postgresRepositories) {
      await repository.deleteLongTermMemory(created.id, env.NOX_USER_ID);
      await postgresRepositories.close();
    }
  }
}
