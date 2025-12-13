/**
 * Tag Parser - Port of tag_parser.py
 * 
 * Parses custom tags in markdown content with the following formats:
 * - <name!value>content</name!>
 * - <name!"quoted value">content</name!>
 * - <name![[wikilink]]>content</name!>
 * - <name!>content</name!>
 * - <name!value>
 * - <name!"quoted value">
 * - <name![[wikilink]]>
 * - <name!>
 */

import { ParsedTag } from '../types';

export type ReplacementFunction = (
  value: string | null,
  text: string | null,
  context: unknown
) => string;

export type Replacements = Record<string, ReplacementFunction>;

/**
 * Parse and process custom tags in the given content.
 * 
 * @param content - The input text containing tags to be processed
 * @param replacements - A dictionary of tag names to replacement functions
 * @param context - Additional context to be passed to replacement functions
 * @returns A tuple of [processed content, list of parsed tags]
 */
export function processTags(
  content: string,
  replacements: Replacements = {},
  context: unknown = null
): [string, ParsedTag[]] {
  const processed: ParsedTag[] = [];
  
  // Regex pattern to match all supported tag formats
  // IMPORTANT: Only matches LOWERCASE tag names (a-z) so uppercase examples like <AI!> are ignored
  // Matches:
  // Group 1: name (for tags with content)
  // Group 2: quoted value (with content)
  // Group 3: wikilink value (with content)
  // Group 4: unquoted value (with content)
  // Group 5: inner text/content
  // Group 6: name (for self-closing tags)
  // Group 7: quoted value (self-closing)
  // Group 8: wikilink value (self-closing)
  // Group 9: unquoted value (self-closing)
  const pattern = /<([a-z][a-z0-9_]*)!(?:"((?:[^"\\]|\\.)*)"|(?:\[\[(.*?)\]\])|([^>\s]+))?>(.*?)<\/\1!>|<([a-z][a-z0-9_]*)!(?:"((?:[^"\\]|\\.)*)"|(?:\[\[(.*?)\]\])|([^>\s]+))?>/gs;
  
  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;
  
  while ((match = pattern.exec(content)) !== null) {
    // Add content before this match
    result += content.slice(lastIndex, match.index);
    
    let name: string;
    let value: string | null;
    let text: string | null;
    
    if (match[1]) {
      // Matched a tag with content
      name = match[1].toLowerCase();
      value = match[2] ?? match[3] ?? match[4] ?? null;
      text = match[5];
    } else {
      // Matched a self-closing tag
      name = match[6].toLowerCase();
      value = match[7] ?? match[8] ?? match[9] ?? null;
      text = null;
    }
    
    // Handle different value formats
    if (value !== null) {
      if (match[2] || match[7]) {
        // Quoted value: unescape
        value = value.replace(/\\(.)/g, '$1');
      } else if (match[3] || match[8]) {
        // Wikilink format: preserve as [[...]]
        value = `[[${value}]]`;
      } else {
        // Unquoted value: replace escaped spaces
        value = value.replace(/\\ /g, ' ');
      }
    }
    
    const parsedTag: ParsedTag = {
      name,
      value,
      text,
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    };
    
    processed.push(parsedTag);
    
    // Apply replacement if the tag name is in the replacements dictionary
    if (name in replacements) {
      result += replacements[name](value, text, context);
    } else {
      // Keep the original tag if no replacement
      result += match[0];
    }
    
    lastIndex = pattern.lastIndex;
  }
  
  // Add remaining content after the last match
  result += content.slice(lastIndex);
  
  return [result, processed];
}

/**
 * Extract all tags from content without processing
 */
export function extractTags(content: string): ParsedTag[] {
  const [, tags] = processTags(content);
  return tags;
}

/**
 * Check if content contains a specific tag
 */
export function hasTag(content: string, tagName: string): boolean {
  const tags = extractTags(content);
  return tags.some(tag => tag.name === tagName.toLowerCase());
}

/**
 * Get all values for a specific tag name
 */
export function getTagValues(content: string, tagName: string): (string | null)[] {
  const tags = extractTags(content);
  return tags
    .filter(tag => tag.name === tagName.toLowerCase())
    .map(tag => tag.value);
}

/**
 * Remove a specific tag from content (self-closing or with content)
 */
export function removeTag(content: string, tagName: string): string {
  const [result] = processTags(content, {
    [tagName.toLowerCase()]: () => '',
  });
  return result;
}

/**
 * Escape tag names in content to prevent processing
 * (converts lowercase to uppercase)
 */
export function escapeTags(content: string, tagNames: string[]): string {
  const replacements: Replacements = {};
  
  for (const name of tagNames) {
    replacements[name.toLowerCase()] = (value, text) => {
      const upperName = name.toUpperCase();
      const valueStr = value ?? '';
      if (text === null) {
        return `<${upperName}!${valueStr}>`;
      } else {
        return `<${upperName}!${valueStr}>${text}</${upperName}!>`;
      }
    };
  }
  
  const [result] = processTags(content, replacements);
  return result;
}

