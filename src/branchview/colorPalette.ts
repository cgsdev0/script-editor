/** Catppuccin Mocha palette — 12 branch colors */
export const BRANCH_COLORS = [
  "#89b4fa", // blue
  "#f38ba8", // red
  "#a6e3a1", // green
  "#f9e2af", // yellow
  "#cba6f7", // mauve
  "#fab387", // peach
  "#94e2d5", // teal
  "#f5c2e7", // pink
  "#74c7ec", // sapphire
  "#eba0ac", // maroon
  "#b4befe", // lavender
  "#89dceb", // sky
] as const;

let colorIndex = 0;

export function resetColorIndex(): void {
  colorIndex = 0;
}

export function nextBranchColor(): string {
  const color = BRANCH_COLORS[colorIndex % BRANCH_COLORS.length];
  colorIndex++;
  return color;
}
