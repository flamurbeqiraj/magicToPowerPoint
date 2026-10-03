import type { SlideElement } from './model';

/** A boundary for a future licensed image-search service. Results are curated before they enter slide state. */
export type ImageResult = { url: string; attribution: string; license?: string; provider: string };
export interface ImageProvider {
  search(query: string, signal?: AbortSignal): Promise<ImageResult[]>;
  authorizeImage(result: ImageResult): Promise<Extract<SlideElement, {type:'image'}>>;
}

