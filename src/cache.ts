import { mkdirSync } from "node:fs";
import * as cache from "@actions/cache";
import { dockerLoad, dockerSave } from "./docker.js";

const CACHE_DIR = "/tmp/docker-cache";

/** Ensure the cache directory exists */
function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

/** Build cache key from image versions */
function cacheKey(serverImage: string, scannerImage: string): string {
  const sv = serverImage.replace(/[/:]/g, "-");
  const sc = scannerImage.replace(/[/:]/g, "-");
  return `sq-docker-${sv}-${sc}`;
}

/**
 * Try to restore Docker images from cache.
 * Returns true if cache hit and images were loaded.
 */
export async function restoreDockerCache(
  serverImage: string,
  scannerImage: string,
): Promise<boolean> {
  const key = cacheKey(serverImage, scannerImage);
  const hit = await cache.restoreCache([CACHE_DIR], key);
  if (hit) {
    await dockerLoad(`${CACHE_DIR}/server.tar`);
    await dockerLoad(`${CACHE_DIR}/scanner.tar`);
  }
  return hit !== undefined;
}

/**
 * Save Docker images to cache (only call on cache miss, after pull).
 */
export async function saveDockerCache(
  serverImage: string,
  scannerImage: string,
): Promise<void> {
  ensureCacheDir();
  const key = cacheKey(serverImage, scannerImage);
  await dockerSave(serverImage, `${CACHE_DIR}/server.tar`);
  await dockerSave(scannerImage, `${CACHE_DIR}/scanner.tar`);
  await cache.saveCache([CACHE_DIR], key);
}
