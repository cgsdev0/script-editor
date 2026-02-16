import "./style.css";
import typescriptLogo from "./typescript.svg";
import viteLogo from "/vite.svg";
import { setupCounter } from "./counter.ts";
import { lines } from "./schema.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <a href="https://vite.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Vite + TypeScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite and TypeScript logos to learn more
    </p>
  </div>
`;

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

setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
