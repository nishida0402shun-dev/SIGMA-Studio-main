import type { RetrievalService, SearchHit, SearchQuery, SearchResponse } from "../contracts.js";

export interface RetrievalBackend {
  search(query: SearchQuery, limit: number, signal?: AbortSignal): Promise<readonly SearchHit[]>;
}

export interface HybridRetrievalOptions {
  lexical: RetrievalBackend;
  semantic: RetrievalBackend;
  /** Reciprocal-rank smoothing constant. Defaults to 60. */
  rankConstant?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  defaultLimit?: number;
  maxLimit?: number;
  indexVersion?: string;
}

interface RankedHit {
  hit: SearchHit;
  fusedScore: number;
  lexicalRank?: number;
  semanticRank?: number;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Retrieval cancelled");
  }
}

function identity(hit: SearchHit): string {
  return hit.domain + ":" + hit.id;
}

/**
 * Combines lexical and semantic rankings using weighted reciprocal-rank fusion.
 * Backends stay replaceable: SIGMA owns the fusion/provenance contract, not the
 * underlying FTS or vector engine.
 */
export function createHybridRetrievalService(options: HybridRetrievalOptions): RetrievalService {
  const rankConstant = options.rankConstant ?? 60;
  const lexicalWeight = options.lexicalWeight ?? 1;
  const semanticWeight = options.semanticWeight ?? 1;
  const defaultLimit = options.defaultLimit ?? 10;
  const maxLimit = options.maxLimit ?? 100;

  if (!Number.isFinite(rankConstant) || rankConstant < 1) {
    throw new Error("rankConstant must be a finite number greater than or equal to 1");
  }
  if (!Number.isFinite(lexicalWeight) || lexicalWeight < 0) {
    throw new Error("lexicalWeight must be a finite non-negative number");
  }
  if (!Number.isFinite(semanticWeight) || semanticWeight < 0) {
    throw new Error("semanticWeight must be a finite non-negative number");
  }
  if (!Number.isInteger(defaultLimit) || defaultLimit < 1) {
    throw new Error("defaultLimit must be a positive integer");
  }
  if (!Number.isInteger(maxLimit) || maxLimit < defaultLimit) {
    throw new Error("maxLimit must be an integer greater than or equal to defaultLimit");
  }

  return {
    async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
      checkAbort(signal);
      const text = query.text.normalize("NFKC").trim();
      if (!text) {
        return {
          hits: [],
          trace: { pipeline: "sigma-hybrid-rrf-v1", indexVersion: options.indexVersion, elapsedMs: 0 },
        };
      }

      const startedAt = Date.now();
      const requestedLimit = query.limit ?? defaultLimit;
      const limit = Math.max(1, Math.min(maxLimit, Math.floor(requestedLimit)));
      const normalizedQuery: SearchQuery = { ...query, text, limit };
      const [lexicalHits, semanticHits] = await Promise.all([
        lexicalWeight > 0 ? options.lexical.search(normalizedQuery, limit, signal) : Promise.resolve([]),
        semanticWeight > 0 ? options.semantic.search(normalizedQuery, limit, signal) : Promise.resolve([]),
      ]);
      checkAbort(signal);

      const fused = new Map<string, RankedHit>();
      const accumulate = (hits: readonly SearchHit[], weight: number, kind: "lexicalRank" | "semanticRank") => {
        hits.forEach((hit, index) => {
          if (query.domains && !query.domains.includes(hit.domain)) return;
          if (query.sourceIds && (!hit.source || !query.sourceIds.includes(hit.source.sourceId))) return;
          const key = identity(hit);
          const current = fused.get(key);
          const rank = index + 1;
          const contribution = weight / (rankConstant + rank);
          if (current) {
            current.fusedScore += contribution;
            current[kind] = rank;
            current.hit = {
              ...current.hit,
              ...(!current.hit.source && hit.source ? { source: hit.source } : {}),
              metadata: { ...hit.metadata, ...current.hit.metadata },
            };
          } else {
            fused.set(key, {
              hit,
              fusedScore: contribution,
              [kind]: rank,
            });
          }
        });
      };

      accumulate(lexicalHits, lexicalWeight, "lexicalRank");
      accumulate(semanticHits, semanticWeight, "semanticRank");

      const hits = [...fused.values()]
        .sort((a, b) =>
          b.fusedScore - a.fusedScore
          || (a.lexicalRank ?? Number.MAX_SAFE_INTEGER) - (b.lexicalRank ?? Number.MAX_SAFE_INTEGER)
          || (a.semanticRank ?? Number.MAX_SAFE_INTEGER) - (b.semanticRank ?? Number.MAX_SAFE_INTEGER)
          || identity(a.hit).localeCompare(identity(b.hit)),
        )
        .slice(0, limit)
        .map(({ hit, fusedScore }) => ({ ...hit, score: fusedScore }));

      return {
        hits,
        trace: {
          pipeline: "sigma-hybrid-rrf-v1",
          ...(options.indexVersion ? { indexVersion: options.indexVersion } : {}),
          elapsedMs: Date.now() - startedAt,
        },
      };
    },
  };
}
