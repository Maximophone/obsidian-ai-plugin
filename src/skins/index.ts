/**
 * Skin System - Entry point
 * 
 * Manages skin registration and conversion between formats.
 */

export * from './types';

import { Skin, SkinName } from './types';
import { canonicalSkin } from './canonical';
import { modernSkin } from './modern';

/**
 * Registry of available skins
 */
const skins: Record<SkinName, Skin> = {
  canonical: canonicalSkin,
  modern: modernSkin,
};

/**
 * Get a skin by name
 */
export function getSkin(name: SkinName): Skin {
  return skins[name] || canonicalSkin;
}

/**
 * Get all available skins
 */
export function getAllSkins(): Skin[] {
  return Object.values(skins);
}

/**
 * Get all skin names
 */
export function getSkinNames(): SkinName[] {
  return Object.keys(skins) as SkinName[];
}

/**
 * SkinManager - Handles conversions between skins
 * 
 * Usage:
 * 1. Before parsing: content = skinManager.toCanonical(content)
 * 2. After processing: output = skinManager.fromCanonical(output, activeSkin)
 */
export class SkinManager {
  private activeSkin: SkinName = 'modern';  // Default to modern
  
  /**
   * Set the active skin for output
   */
  setActiveSkin(name: SkinName): void {
    if (skins[name]) {
      this.activeSkin = name;
    }
  }
  
  /**
   * Get the active skin name
   */
  getActiveSkin(): SkinName {
    return this.activeSkin;
  }
  
  /**
   * Get the active skin instance
   */
  getActiveSkinInstance(): Skin {
    return getSkin(this.activeSkin);
  }
  
  /**
   * Convert content from any skin to canonical format
   * Tries all skins to normalize the content
   */
  toCanonical(content: string): string {
    // First try the active skin (most likely format)
    let result = getSkin(this.activeSkin).toCanonical(content);
    
    // Then try modern skin if not active (in case document was edited with different skin)
    if (this.activeSkin !== 'modern') {
      result = modernSkin.toCanonical(result);
    }
    
    // Canonical skin's toCanonical is identity, so no need to call it again
    
    return result;
  }
  
  /**
   * Convert content from canonical format to the active skin format
   */
  fromCanonical(content: string): string {
    return getSkin(this.activeSkin).fromCanonical(content);
  }
  
  /**
   * Convert content from canonical format to a specific skin
   */
  fromCanonicalTo(content: string, skinName: SkinName): string {
    return getSkin(skinName).fromCanonical(content);
  }
}

// Export singleton instance
export const skinManager = new SkinManager();

// Re-export skins for direct access
export { canonicalSkin } from './canonical';
export { modernSkin } from './modern';




