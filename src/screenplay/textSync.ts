/**
 * String diff utilities for syncing ProseMirror text changes to Y.Text.
 *
 * Uses a common prefix/suffix algorithm to compute the minimal edit
 * (single contiguous replace) needed to transform oldStr into newStr.
 */

import type * as Y from "yjs";

export interface TextDiff {
  pos: number;
  deleteCount: number;
  insert: string;
}

/**
 * Compute a minimal single-span diff between two strings.
 * Finds the longest common prefix and suffix, then returns the
 * position, delete count, and insertion text for the changed region.
 */
export function diffStrings(oldStr: string, newStr: string): TextDiff {
  let prefix = 0;
  while (
    prefix < oldStr.length &&
    prefix < newStr.length &&
    oldStr[prefix] === newStr[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldStr.length - prefix &&
    suffix < newStr.length - prefix &&
    oldStr[oldStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    pos: prefix,
    deleteCount: oldStr.length - prefix - suffix,
    insert: newStr.slice(prefix, newStr.length - suffix),
  };
}

/**
 * Apply a text diff to a Y.Text instance.
 * Only performs mutations if the text actually changed.
 */
export function applyTextDiff(
  yText: Y.Text,
  oldStr: string,
  newStr: string,
): void {
  if (oldStr === newStr) return;

  const diff = diffStrings(oldStr, newStr);

  if (diff.deleteCount > 0) {
    yText.delete(diff.pos, diff.deleteCount);
  }
  if (diff.insert.length > 0) {
    yText.insert(diff.pos, diff.insert);
  }
}
