declare module "ruvector-onnx-embeddings-wasm/loader.js" {
  type Embedder = {
    embedOne(text: string): Float32Array | number[];
  };

  export function createEmbedder(modelName?: string): Promise<Embedder>;
}
