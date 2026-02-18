import type { Embedder } from './types.js';

const EMBEDDING_DIMENSIONS = 384;

export class TransformersEmbedder implements Embedder {
  private extractor: ExtractorPipeline | null = null;
  private readonly modelName: string;

  constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    const { pipeline } = await import('@xenova/transformers');
    this.extractor = await pipeline('feature-extraction', this.modelName) as ExtractorPipeline;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = this.requireExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = this.requireExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;
    const dim = this.dimensions();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }
    return vectors;
  }

  dimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  private requireExtractor(): ExtractorPipeline {
    if (!this.extractor) {
      throw new Error('Embedder not initialised. Call initialize() first.');
    }
    return this.extractor;
  }
}

// Minimal type for the transformers pipeline — avoids importing the full package at type level.
interface ExtractorPipeline {
  (text: string | string[], options: { pooling: string; normalize: boolean }): Promise<{
    data: Float32Array;
  }>;
}
