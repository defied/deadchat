import type { AssetTypeHandler } from './types';
import { characterPortraitHandler } from './characterPortraitHandler';

const handlers = new Map<string, AssetTypeHandler>();

function register(handler: AssetTypeHandler): void {
  handlers.set(handler.assetType, handler);
}

register(characterPortraitHandler);

export function getHandler(assetType: string): AssetTypeHandler {
  const handler = handlers.get(assetType);
  if (!handler) {
    throw new Error(
      `No asset-type handler registered for "${assetType}". Known types: ${[...handlers.keys()].join(', ')}`
    );
  }
  return handler;
}

export function listAssetTypes(): string[] {
  return [...handlers.keys()];
}
