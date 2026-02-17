import "./style.css";
import "prosemirror-view/style/prosemirror.css";
import { Schema, Node as PMNode, type DOMOutputSpec } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { lines } from "./schema.ts";

export const scriptSchema = new Schema({
  nodes: {
    doc: {
      content: "entry+",
    },
    entry: {
      attrs: { id: { default: "" } },
      content: "dialogue | decision",
      toDOM(node): DOMOutputSpec {
        return ["section", { class: "entry", "data-entry-id": node.attrs.id }, 0];
      },
    },
    dialogue: {
      attrs: {
        char: { default: "" },
        delay: { default: null },
        next: { default: null },
        trigger: { default: null },
        unskippable: { default: false },
        randomize: { default: false },
      },
      content: "line+",
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = { class: "dialogue" };
        if (node.attrs.next) attrs["data-next"] = node.attrs.next;
        return [
          "div",
          attrs,
          ["div", { class: "char-name" }, node.attrs.char],
          ["div", { class: "dialogue-lines" }, 0],
        ];
      },
    },
    line: {
      attrs: {
        trigger: { default: null },
      },
      content: "text*",
      toDOM(node): DOMOutputSpec {
        if (node.attrs.trigger) {
          return [
            "p",
            { class: "line", "data-trigger": node.attrs.trigger },
            0,
          ];
        }
        return ["p", { class: "line" }, 0];
      },
    },
    decision: {
      content: "choice+",
      toDOM(): DOMOutputSpec {
        return [
          "div",
          { class: "decision" },
          ["div", { class: "char-name", contenteditable: "false" }, "PLAYER"],
          ["div", { class: "decision-choices" }, 0],
        ];
      },
    },
    choice: {
      attrs: {
        next: { default: null },
        effect: { default: null },
        cond: { default: null },
      },
      content: "text*",
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = { class: "choice" };
        if (node.attrs.next) attrs["data-next"] = node.attrs.next;
        return ["div", attrs, 0];
      },
    },
    text: {
      group: "inline",
      inline: true,
    },
  },
});

function linesToDoc(data: typeof lines): PMNode {
  const s = scriptSchema;

  const entries = Object.entries(data).map(([id, node]) => {
    let content: PMNode;

    if ("input" in node) {
      const choices = (node as any).input.map((choice: any) =>
        s.nodes.choice.create(
          {
            next: choice.next ?? null,
            effect: choice.effect ?? null,
            cond: choice.cond ?? null,
          },
          choice.text ? s.text(choice.text) : undefined,
        ),
      );
      content = s.nodes.decision.create(null, choices);
    } else {
      const d = node as any;
      const textArray = Array.isArray(d.text) ? d.text : [d.text];
      const lineNodes = textArray.map((l: any) => {
        if (typeof l === "string") {
          return s.nodes.line.create(null, l ? s.text(l) : undefined);
        }
        return s.nodes.line.create(
          { trigger: l.trigger ?? null },
          l.text ? s.text(l.text) : undefined,
        );
      });
      content = s.nodes.dialogue.create(
        {
          char: d.char,
          delay: d.delay ?? null,
          next: d.next ?? null,
          trigger: d.trigger ?? null,
          unskippable: d.unskippable ?? false,
          randomize: d.randomize ?? false,
        },
        lineNodes,
      );
    }

    return s.nodes.entry.create({ id }, content);
  });

  return s.nodes.doc.create(null, entries);
}

function drawArrows(view: EditorView) {
  const root = view.dom;
  root.querySelectorAll(".arrow-svg").forEach((el) => el.remove());

  const choices = root.querySelectorAll<HTMLElement>(".choice[data-next]");
  if (!choices.length) return;

  const ns = "http://www.w3.org/2000/svg";
  const margin = 240;
  const r = 6; // corner radius

  function makeSvg(side: "left" | "right"): SVGSVGElement {
    const svg = document.createElementNS(ns, "svg");
    svg.classList.add("arrow-svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style[side] = "0";
    svg.style.width = margin + "px";
    svg.style.height = root.scrollHeight + "px";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", `arrowhead-${side}`);
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const mp = document.createElementNS(ns, "path");
    mp.setAttribute("d", "M0,0 L8,3 L0,6 Z");
    mp.setAttribute("fill", "#666");
    marker.appendChild(mp);
    defs.appendChild(marker);
    svg.appendChild(defs);
    return svg;
  }

  // measure the x position where an element's text content ends,
  // returned relative to the right margin SVG (x=0 = content right edge)
  function textEndXInRightMargin(el: HTMLElement): number {
    const rootRect = root.getBoundingClientRect();
    const svgLeft = rootRect.right - margin;
    // walk to find the last text node
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lastText: Text | null = null;
    while (walker.nextNode()) lastText = walker.currentNode as Text;
    if (lastText && lastText.length > 0) {
      const range = document.createRange();
      range.setStart(lastText, lastText.length);
      range.setEnd(lastText, lastText.length);
      const rect = range.getBoundingClientRect();
      return rect.right - svgLeft + 8;
    }
    return el.getBoundingClientRect().right - svgLeft;
  }

  // collect arrows, split by direction
  type ArrowInfo = { choiceY: number; targetY: number; span: number; startX?: number };
  const downArrows: ArrowInfo[] = [];
  const upArrows: ArrowInfo[] = [];

  choices.forEach((choiceEl) => {
    const nextId = choiceEl.dataset.next!;
    const targetEl = root.querySelector<HTMLElement>(
      `.entry[data-entry-id="${nextId}"]`,
    );
    if (!targetEl) return;

    const rootTop = root.getBoundingClientRect().top;
    const choiceY =
      choiceEl.getBoundingClientRect().top - rootTop + choiceEl.offsetHeight / 2;
    const targetY =
      targetEl.getBoundingClientRect().top - rootTop + 8;

    const info: ArrowInfo = {
      choiceY,
      targetY,
      span: Math.abs(targetY - choiceY),
    };
    if (targetY > choiceY) {
      downArrows.push(info);
    } else {
      info.startX = textEndXInRightMargin(choiceEl);
      upArrows.push(info);
    }
  });

  function assignColumns(arrows: ArrowInfo[]): number[] {
    const indexed = arrows.map((a, i) => ({ span: a.span, idx: i }));
    indexed.sort((a, b) => a.span - b.span);
    const cols: number[] = new Array(arrows.length);
    indexed.forEach((a, col) => {
      cols[a.idx] = col;
    });
    return cols;
  }

  function addPaths(
    svg: SVGSVGElement,
    arrows: ArrowInfo[],
    cols: number[],
    side: "left" | "right",
  ) {
    // distribute columns evenly across the margin
    // col 0 = closest to content (x near 68), max col = furthest out (x near 8)
    const xInner = 228; // closest to content
    const xOuter = 8; // furthest from content
    const maxCol = Math.max(...cols, 0);
    const xStep = maxCol > 0 ? (xInner - xOuter) / maxCol : 0;

    arrows.forEach((a, i) => {
      const col = cols[i];
      const x = xInner - col * xStep;
      const { choiceY, targetY } = a;
      let d: string;

      if (side === "left") {
        // downward: left margin, x=236 is the content edge
        d = [
          `M 236 ${choiceY}`,
          `H ${x + r}`,
          `A ${r} ${r} 0 0 0 ${x} ${choiceY + r}`,
          `V ${targetY - r}`,
          `A ${r} ${r} 0 0 0 ${x + r} ${targetY}`,
          `H 236`,
        ].join(" ");
      } else {
        // upward: right margin, startX from text end
        const sx = a.startX ?? 4;
        const cx = margin - x; // mirror: inner columns closer to content (lower x)
        d = [
          `M ${sx} ${choiceY}`,
          `H ${cx - r}`,
          `A ${r} ${r} 0 0 0 ${cx} ${choiceY - r}`,
          `V ${targetY + r}`,
          `A ${r} ${r} 0 0 0 ${cx - r} ${targetY}`,
          `H 4`,
        ].join(" ");
      }

      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#666");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", `url(#arrowhead-${side})`);
      svg.appendChild(path);
    });
  }

  if (downArrows.length) {
    const svg = makeSvg("left");
    addPaths(svg, downArrows, assignColumns(downArrows), "left");
    root.appendChild(svg);
  }

  if (upArrows.length) {
    const svg = makeSvg("right");
    addPaths(svg, upArrows, assignColumns(upArrows), "right");
    root.appendChild(svg);
  }

  // exit arrows: choices or dialogues without a next
  const exits = root.querySelectorAll<HTMLElement>(
    ".choice:not([data-next]), .dialogue:not([data-next])",
  );
  if (exits.length) {
    // reuse or create the right SVG
    let rightSvg = root.querySelector<SVGSVGElement>(".arrow-svg-exits");
    if (!rightSvg) {
      rightSvg = makeSvg("right");
      rightSvg.classList.add("arrow-svg-exits");
      // add a yellow arrowhead marker
      const defs = rightSvg.querySelector("defs")!;
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", "arrowhead-exit");
      marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "3");
      marker.setAttribute("orient", "auto");
      const mp = document.createElementNS(ns, "path");
      mp.setAttribute("d", "M0,0 L8,3 L0,6 Z");
      mp.setAttribute("fill", "#b8a038");
      marker.appendChild(mp);
      defs.appendChild(marker);
      root.appendChild(rightSvg);
    }

    const rootTop = root.getBoundingClientRect().top;
    exits.forEach((el) => {
      let measureEl: HTMLElement = el;
      if (el.classList.contains("dialogue")) {
        measureEl = el.querySelector(".char-name") ?? el;
      }
      const y =
        measureEl.getBoundingClientRect().top - rootTop + measureEl.offsetHeight / 2;
      const sx = el.classList.contains("choice")
        ? textEndXInRightMargin(el)
        : textEndXInRightMargin(measureEl);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", `M ${sx} ${y} H ${sx + 36}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#b8a038");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#arrowhead-exit)");
      rightSvg!.appendChild(path);
    });
  }
}

const doc = linesToDoc(lines);
const state = EditorState.create({ doc });

const view = new EditorView(document.querySelector("#app")!, {
  state,
  editable: () => false,
});

// draw arrows after initial render
requestAnimationFrame(() => drawArrows(view));
