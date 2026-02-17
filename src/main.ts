import "./style.css";
import { lines } from "./schema.ts";

console.log(lines);

function findEntrypoints(lines: any): string[] {
  const referenced = new Set();
  Object.keys(lines).forEach((key) => {
    const line = lines[key];
    if (lines[key].hasOwnProperty("next")) {
      referenced.add(line.next);
    }
    if (lines[key].hasOwnProperty("input")) {
      line.input.forEach((input: any) => {
        if (input.hasOwnProperty("next")) {
          referenced.add(input.next);
        }
      });
    }
  });
  return Object.keys(lines).filter((line) => !referenced.has(line));
}
console.log(findEntrypoints(lines));
