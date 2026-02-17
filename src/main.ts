import "./style.css";
import "prosemirror-view/style/prosemirror.css";
import { Schema, Node as PMNode, type DOMOutputSpec } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { lines } from "./schema.ts";
import { EditorView as CMEditorView, keymap as cmKeymap } from "@codemirror/view";
import { EditorState as CMEditorState } from "@codemirror/state";
import { json as jsonLang } from "@codemirror/lang-json";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { undo, redo } from "y-prosemirror";
import * as collab from "./collab.ts";
import { Notyf } from "notyf";
import "notyf/notyf.min.css";

const notyf = new Notyf({ duration: 3000, position: { x: "right", y: "top" }, ripple: false });

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
        extra: { default: null },
      },
      content: "line+",
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = { class: "dialogue" };
        if (node.attrs.next) attrs["data-next"] = node.attrs.next;
        return [
          "div",
          attrs,
          ["div", { class: "char-name", contenteditable: "false", draggable: "true" }, ["span", { class: "char-name-link" }, node.attrs.char]],
          ["div", { class: "dialogue-lines" }, 0],
        ];
      },
    },
    line: {
      attrs: {
        trigger: { default: null },
        extra: { default: null },
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
      attrs: {
        extra: { default: null },
      },
      content: "choice+",
      toDOM(): DOMOutputSpec {
        return [
          "div",
          { class: "decision" },
          ["div", { class: "char-name", contenteditable: "false", draggable: "true" }, ["span", { class: "char-name-link" }, "PLAYER"]],
          ["div", { class: "decision-choices" }, 0],
        ];
      },
    },
    choice: {
      attrs: {
        next: { default: null },
        effect: { default: null },
        cond: { default: null },
        checked: { default: false },
        extra: { default: null },
      },
      content: "text*",
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = { class: "choice" };
        if (node.attrs.next) attrs["data-next"] = node.attrs.next;
        if (node.attrs.checked) attrs["data-checked"] = "true";
        const indicators: DOMOutputSpec[] = [];
        if (node.attrs.cond) indicators.push(["span", { class: "choice-badge choice-badge-cond", contenteditable: "false" }, "?"]);
        if (node.attrs.effect) indicators.push(["span", { class: "choice-badge choice-badge-effect", contenteditable: "false" }, "!"]);
        return [
          "div",
          attrs,
          ["span", { class: "choice-checkbox", contenteditable: "false" }, node.attrs.checked ? "\u2611" : "\u2610"],
          ["span", { class: "drag-handle", contenteditable: "false", draggable: "true" }, "\u2847"],
          ["span", { class: "choice-text" }, 0],
          ...indicators,
        ];
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
      const { input: rawInput, ...decisionExtra } = node as any;
      const choices = rawInput.map((choice: any) => {
        const { text: ct, next: cn, effect: ce, cond: cc, ...choiceExtra } = choice;
        return s.nodes.choice.create(
          {
            next: cn ?? null,
            effect: ce ?? null,
            cond: cc ?? null,
            extra: Object.keys(choiceExtra).length > 0 ? choiceExtra : null,
          },
          ct ? s.text(ct) : undefined,
        );
      });
      content = s.nodes.decision.create(
        { extra: Object.keys(decisionExtra).length > 0 ? decisionExtra : null },
        choices,
      );
    } else {
      const { char, text: rawText, delay, next, trigger, unskippable, randomize, ...dialogueExtra } = node as any;
      const textArray = Array.isArray(rawText) ? rawText : [rawText];
      const lineNodes = textArray.map((l: any) => {
        if (typeof l === "string") {
          return s.nodes.line.create(null, l ? s.text(l) : undefined);
        }
        const { text: lt, trigger: ltrig, ...lineExtra } = l;
        return s.nodes.line.create(
          {
            trigger: ltrig ?? null,
            extra: Object.keys(lineExtra).length > 0 ? lineExtra : null,
          },
          lt ? s.text(lt) : undefined,
        );
      });
      content = s.nodes.dialogue.create(
        {
          char,
          delay: delay ?? null,
          next: next ?? null,
          trigger: trigger ?? null,
          unskippable: unskippable ?? false,
          randomize: randomize ?? false,
          extra: Object.keys(dialogueExtra).length > 0 ? dialogueExtra : null,
        },
        lineNodes,
      );
    }

    return s.nodes.entry.create({ id }, content);
  });

  return s.nodes.doc.create(null, entries);
}

// overlay container for SVGs — sits outside ProseMirror's managed DOM
let overlay: HTMLElement;
let customDragActive = false;

let charNameMousedown: { x: number; y: number; target: HTMLElement } | null = null;
let activeJsonEditor: { popup: HTMLElement; cmView: CMEditorView; save: () => void; cleanup: () => void; entryId: string } | null = null;

let entryIdCounter = 0;
function generateEntryId(): string {
  return `new_${++entryIdCounter}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// maps SVG group elements to the source DOM element that owns the `next` attr
let arrowSourceMap = new Map<Element, HTMLElement>();
let exitArrowSourceMap = new Map<Element, HTMLElement>();
let selectedArrowGroup: SVGGElement | null = null;

function selectArrow(group: SVGGElement | null) {
  if (selectedArrowGroup) {
    const vis = selectedArrowGroup.querySelector(".arrow-visible");
    if (vis) {
      const origStroke = vis.getAttribute("marker-end")?.includes("seq") ? "#555" : "#666";
      vis.setAttribute("stroke", origStroke);
      // restore original marker
      const markerEnd = vis.getAttribute("marker-end") ?? "";
      vis.setAttribute("marker-end", markerEnd.replace("-selected", ""));
    }
    selectedArrowGroup.classList.remove("arrow-selected");
  }
  selectedArrowGroup = group;
  if (group) {
    const vis = group.querySelector(".arrow-visible");
    if (vis) {
      vis.setAttribute("stroke", "#e8e857");
      // swap to selected marker
      const markerEnd = vis.getAttribute("marker-end") ?? "";
      if (!markerEnd.includes("-selected")) {
        vis.setAttribute("marker-end", markerEnd.replace(")", "-selected)"));
      }
    }
    group.classList.add("arrow-selected");
  }
}

function drawArrows(view: EditorView) {
  const root = view.dom;
  overlay.querySelectorAll(".arrow-svg").forEach((el) => el.remove());
  arrowSourceMap.clear();
  exitArrowSourceMap.clear();
  if (selectedArrowGroup) selectedArrowGroup = null;

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

    // selected-state marker
    const markerSel = marker.cloneNode(true) as SVGMarkerElement;
    markerSel.setAttribute("id", `arrowhead-${side}-selected`);
    markerSel.querySelector("path")!.setAttribute("fill", "#e8e857");
    defs.appendChild(markerSel);

    svg.appendChild(defs);
    return svg;
  }

  function textEndXInRightMargin(el: HTMLElement): number {
    const rootRect = root.getBoundingClientRect();
    const svgLeft = rootRect.right - margin;
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

  // ArrowInfo now tracks the source DOM element
  type ArrowInfo = {
    choiceY: number;
    targetY: number;
    span: number;
    startX?: number;
    sourceEl: HTMLElement; // the element with data-next
  };
  const downArrows: ArrowInfo[] = [];
  const upArrows: ArrowInfo[] = [];

  const rootTop = root.getBoundingClientRect().top;

  const choices = root.querySelectorAll<HTMLElement>(".choice[data-next]");
  choices.forEach((choiceEl) => {
    if (choiceEl.closest(".entry-hidden") || choiceEl.classList.contains("choice-dimmed")) return;
    const nextId = choiceEl.dataset.next!;
    const targetEl = root.querySelector<HTMLElement>(
      `.entry[data-entry-id="${nextId}"]`,
    );
    if (!targetEl || targetEl.classList.contains("entry-hidden")) return;

    const choiceY =
      choiceEl.getBoundingClientRect().top - rootTop + choiceEl.offsetHeight / 2;
    const targetY =
      targetEl.getBoundingClientRect().top - rootTop + 8;

    const info: ArrowInfo = {
      choiceY,
      targetY,
      span: Math.abs(targetY - choiceY),
      sourceEl: choiceEl,
    };
    if (targetY > choiceY) {
      downArrows.push(info);
    } else {
      info.startX = textEndXInRightMargin(choiceEl);
      upArrows.push(info);
    }
  });

  // sequential connections: dialogue -> immediately next entry
  type SeqArrow = { fromY: number; toY: number; x: number; sourceEl: HTMLElement };
  const seqArrows: SeqArrow[] = [];

  const dialogues = root.querySelectorAll<HTMLElement>(".dialogue[data-next]");
  dialogues.forEach((dialogueEl) => {
    const entry = dialogueEl.closest(".entry") as HTMLElement;
    if (!entry || entry.classList.contains("entry-hidden")) return;
    const nextId = dialogueEl.dataset.next!;

    let nextEntry = entry.nextElementSibling;
    while (nextEntry && (!nextEntry.matches(".entry") || (nextEntry as HTMLElement).classList.contains("entry-hidden")))
      nextEntry = nextEntry.nextElementSibling;

    if (nextEntry && (nextEntry as HTMLElement).dataset.entryId === nextId) {
      // sequential — vertical arrow between entries
      const entryRect = entry.getBoundingClientRect();
      const nextRect = nextEntry.getBoundingClientRect();
      const fromY = entryRect.bottom - root.getBoundingClientRect().top;
      const toY = nextRect.top - root.getBoundingClientRect().top;
      const x = margin + (root.clientWidth - margin * 2) / 2; // center of content
      seqArrows.push({ fromY, toY, x, sourceEl: dialogueEl });
      return;
    }

    const targetEl = root.querySelector<HTMLElement>(
      `.entry[data-entry-id="${nextId}"]`,
    );
    if (!targetEl || targetEl.classList.contains("entry-hidden")) return;

    const charName = dialogueEl.querySelector<HTMLElement>(".char-name");
    const sourceEl = charName ?? dialogueEl;
    const sourceY =
      sourceEl.getBoundingClientRect().top - rootTop + sourceEl.offsetHeight / 2;
    const targetY =
      targetEl.getBoundingClientRect().top - rootTop + 8;

    const info: ArrowInfo = {
      choiceY: sourceY,
      targetY,
      span: Math.abs(targetY - sourceY),
      sourceEl: dialogueEl,
    };
    if (targetY > sourceY) {
      downArrows.push(info);
    } else {
      info.startX = textEndXInRightMargin(sourceEl);
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

  function makeArrowGroup(
    svg: SVGSVGElement,
    d: string,
    side: string,
    sourceEl: HTMLElement,
  ) {
    const g = document.createElementNS(ns, "g");
    g.style.cursor = "pointer";
    g.style.pointerEvents = "auto";

    // invisible wide hit target
    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("d", d);
    hitPath.setAttribute("fill", "none");
    hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "12");
    g.appendChild(hitPath);

    // visible path
    const visPath = document.createElementNS(ns, "path");
    visPath.classList.add("arrow-visible");
    visPath.setAttribute("d", d);
    visPath.setAttribute("fill", "none");
    visPath.setAttribute("stroke", "#666");
    visPath.setAttribute("stroke-width", "1.5");
    visPath.setAttribute("marker-end", `url(#arrowhead-${side})`);
    visPath.style.pointerEvents = "none";
    g.appendChild(visPath);

    svg.appendChild(g);
    arrowSourceMap.set(g, sourceEl);
  }

  function addPaths(
    svg: SVGSVGElement,
    arrows: ArrowInfo[],
    cols: number[],
    side: "left" | "right",
  ) {
    const xInner = 228;
    const xOuter = 8;
    const maxCol = Math.max(...cols, 0);
    const xStep = maxCol > 0 ? (xInner - xOuter) / maxCol : 0;

    arrows.forEach((a, i) => {
      const col = cols[i];
      const x = xInner - col * xStep;
      const { choiceY, targetY } = a;
      let d: string;

      if (side === "left") {
        d = [
          `M 236 ${choiceY}`,
          `H ${x + r}`,
          `A ${r} ${r} 0 0 0 ${x} ${choiceY + r}`,
          `V ${targetY - r}`,
          `A ${r} ${r} 0 0 0 ${x + r} ${targetY}`,
          `H 236`,
        ].join(" ");
      } else {
        const sx = a.startX ?? 4;
        const cx = margin - x;
        d = [
          `M ${sx} ${choiceY}`,
          `H ${cx - r}`,
          `A ${r} ${r} 0 0 0 ${cx} ${choiceY - r}`,
          `V ${targetY + r}`,
          `A ${r} ${r} 0 0 0 ${cx - r} ${targetY}`,
          `H 4`,
        ].join(" ");
      }

      makeArrowGroup(svg, d, side, a.sourceEl);
    });
  }

  if (downArrows.length) {
    const svg = makeSvg("left");
    addPaths(svg, downArrows, assignColumns(downArrows), "left");
    overlay.appendChild(svg);
  }

  if (upArrows.length) {
    const svg = makeSvg("right");
    addPaths(svg, upArrows, assignColumns(upArrows), "right");
    overlay.appendChild(svg);
  }

  // sequential vertical arrows between adjacent entries
  if (seqArrows.length) {
    const seqSvg = document.createElementNS(ns, "svg");
    seqSvg.classList.add("arrow-svg");
    seqSvg.style.position = "absolute";
    seqSvg.style.top = "0";
    seqSvg.style.left = "0";
    seqSvg.style.width = root.scrollWidth + "px";
    seqSvg.style.height = root.scrollHeight + "px";
    seqSvg.style.pointerEvents = "none";
    seqSvg.style.overflow = "visible";

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "arrowhead-seq");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "4");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const mp = document.createElementNS(ns, "path");
    mp.setAttribute("d", "M0,0 L8,3 L0,6 Z");
    mp.setAttribute("fill", "#555");
    marker.appendChild(mp);
    defs.appendChild(marker);

    const markerSel = marker.cloneNode(true) as SVGMarkerElement;
    markerSel.setAttribute("id", "arrowhead-seq-selected");
    markerSel.querySelector("path")!.setAttribute("fill", "#e8e857");
    defs.appendChild(markerSel);

    seqSvg.appendChild(defs);

    seqArrows.forEach((a) => {
      const pad = 4;
      const d = `M ${a.x} ${a.fromY + pad} V ${a.toY - pad}`;

      const g = document.createElementNS(ns, "g");
      g.style.cursor = "pointer";
      g.style.pointerEvents = "auto";

      const hitPath = document.createElementNS(ns, "path");
      hitPath.setAttribute("d", d);
      hitPath.setAttribute("fill", "none");
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", "12");
      g.appendChild(hitPath);

      const visPath = document.createElementNS(ns, "path");
      visPath.classList.add("arrow-visible");
      visPath.setAttribute("d", d);
      visPath.setAttribute("fill", "none");
      visPath.setAttribute("stroke", "#555");
      visPath.setAttribute("stroke-width", "1.5");
      visPath.setAttribute("marker-end", "url(#arrowhead-seq)");
      visPath.style.pointerEvents = "none";
      g.appendChild(visPath);

      seqSvg.appendChild(g);
      arrowSourceMap.set(g, a.sourceEl);
    });

    overlay.appendChild(seqSvg);
  }

  // exit arrows — full-width SVG so hit areas work even when arrows start in content area
  const exits = root.querySelectorAll<HTMLElement>(
    ".choice:not([data-next]), .dialogue:not([data-next])",
  );
  if (exits.length) {
    const exitSvg = document.createElementNS(ns, "svg");
    exitSvg.classList.add("arrow-svg", "arrow-svg-exits");
    exitSvg.style.position = "absolute";
    exitSvg.style.top = "0";
    exitSvg.style.left = "0";
    exitSvg.style.width = root.scrollWidth + "px";
    exitSvg.style.height = root.scrollHeight + "px";
    exitSvg.style.pointerEvents = "none";
    exitSvg.style.overflow = "visible";

    const defs = document.createElementNS(ns, "defs");
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
    exitSvg.appendChild(defs);

    const rootRect = root.getBoundingClientRect();

    exits.forEach((el) => {
      if (el.closest(".entry-hidden") || el.closest(".entry")?.classList.contains("entry-hidden")) return;
      if (el.classList.contains("choice-dimmed")) return;
      let measureEl: HTMLElement = el;
      if (el.classList.contains("dialogue")) {
        measureEl = el.querySelector(".char-name") ?? el;
      }
      const y =
        measureEl.getBoundingClientRect().top - rootTop + measureEl.offsetHeight / 2;

      // compute x relative to the full-width SVG (left edge of editor)
      const walker = document.createTreeWalker(measureEl, NodeFilter.SHOW_TEXT);
      let lastText: Text | null = null;
      while (walker.nextNode()) lastText = walker.currentNode as Text;
      let sx: number;
      if (lastText && lastText.length > 0) {
        const range = document.createRange();
        range.setStart(lastText, lastText.length);
        range.setEnd(lastText, lastText.length);
        sx = range.getBoundingClientRect().right - rootRect.left + 8;
      } else {
        sx = measureEl.getBoundingClientRect().right - rootRect.left + 8;
      }

      const d = `M ${sx} ${y} H ${sx + 36}`;
      const hitPad = 14;

      const g = document.createElementNS(ns, "g");
      g.classList.add("exit-arrow");
      g.style.cursor = "grab";
      g.style.pointerEvents = "auto";

      const hitRect = document.createElementNS(ns, "rect");
      hitRect.setAttribute("x", String(sx - 4));
      hitRect.setAttribute("y", String(y - hitPad));
      hitRect.setAttribute("width", String(44));
      hitRect.setAttribute("height", String(hitPad * 2));
      hitRect.setAttribute("fill", "transparent");
      g.appendChild(hitRect);

      const visPath = document.createElementNS(ns, "path");
      visPath.classList.add("exit-arrow-visible");
      visPath.setAttribute("d", d);
      visPath.setAttribute("fill", "none");
      visPath.setAttribute("stroke", "#b8a038");
      visPath.setAttribute("stroke-width", "1.5");
      visPath.setAttribute("marker-end", "url(#arrowhead-exit)");
      visPath.style.pointerEvents = "none";
      g.appendChild(visPath);

      exitSvg.appendChild(g);
      exitArrowSourceMap.set(g, el);
    });

    overlay.appendChild(exitSvg);
  }
}

function setupArrowInteraction(view: EditorView) {
  const root = view.dom;

  // --- click to select connection arrows ---
  overlay.addEventListener("click", (e) => {
    const g = (e.target as Element).closest("g");
    if (g && arrowSourceMap.has(g)) {
      e.stopPropagation();
      selectArrow(g as SVGGElement);
      return;
    }
    selectArrow(null);
  });

  // --- delete selected arrow ---
  document.addEventListener("keydown", (e) => {
    if (!selectedArrowGroup) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;

    const sourceEl = arrowSourceMap.get(selectedArrowGroup);
    if (!sourceEl) return;

    e.preventDefault();
    const pos = view.posAtDOM(sourceEl, 0);
    const $pos = view.state.doc.resolve(pos);
    const nodePos = $pos.before($pos.depth);
    const node = $pos.parent;

    const tr = view.state.tr.setNodeMarkup(nodePos, null, {
      ...node.attrs,
      next: null,
    });
    view.dispatch(tr);

    selectArrow(null);
    requestAnimationFrame(() => refresh(view));
  });

  // --- drag from exit arrows to create connections ---
  let dragSourceEl: HTMLElement | null = null;
  let dragLine: SVGLineElement | null = null;
  let dragOverlay: SVGSVGElement | null = null;
  let hoveredEntry: HTMLElement | null = null;

  overlay.addEventListener("mousedown", (e) => {
    const g = (e.target as Element).closest(".exit-arrow");
    if (!g || !exitArrowSourceMap.has(g)) return;

    e.preventDefault();
    e.stopPropagation();
    dragSourceEl = exitArrowSourceMap.get(g)!;

    // create a full-editor overlay SVG for the drag line
    const ns = "http://www.w3.org/2000/svg";
    dragOverlay = document.createElementNS(ns, "svg");
    dragOverlay.classList.add("arrow-svg");
    dragOverlay.style.position = "absolute";
    dragOverlay.style.top = "0";
    dragOverlay.style.left = "0";
    dragOverlay.style.width = root.scrollWidth + "px";
    dragOverlay.style.height = root.scrollHeight + "px";
    dragOverlay.style.pointerEvents = "none";
    dragOverlay.style.overflow = "visible";
    dragOverlay.style.zIndex = "1000";

    // compute start position: end of the exit arrow tip
    const rootRect = root.getBoundingClientRect();
    let measureEl: HTMLElement = dragSourceEl;
    if (dragSourceEl.classList.contains("dialogue")) {
      measureEl = dragSourceEl.querySelector(".char-name") ?? dragSourceEl;
    }
    const measRect = measureEl.getBoundingClientRect();
    const startY = measRect.top - rootRect.top + measRect.height / 2;

    // find the text end, same as exit arrow drawing does
    const walker = document.createTreeWalker(measureEl, NodeFilter.SHOW_TEXT);
    let lastText: Text | null = null;
    while (walker.nextNode()) lastText = walker.currentNode as Text;
    let textEndX: number;
    if (lastText && lastText.length > 0) {
      const range = document.createRange();
      range.setStart(lastText, lastText.length);
      range.setEnd(lastText, lastText.length);
      textEndX = range.getBoundingClientRect().right - rootRect.left + 8;
    } else {
      textEndX = measRect.right - rootRect.left + 8;
    }
    const startX = textEndX + 36; // tip of the exit arrow

    dragLine = document.createElementNS(ns, "line");
    dragLine.setAttribute("x1", String(startX));
    dragLine.setAttribute("y1", String(startY));
    dragLine.setAttribute("x2", String(startX));
    dragLine.setAttribute("y2", String(startY));
    dragLine.setAttribute("stroke", "#b8a038");
    dragLine.setAttribute("stroke-width", "2");
    dragLine.setAttribute("stroke-dasharray", "6 4");
    dragOverlay.appendChild(dragLine);
    overlay.appendChild(dragOverlay);

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  });

  function onDragMove(e: MouseEvent) {
    if (!dragLine || !dragOverlay) return;

    const rootRect = root.getBoundingClientRect();
    const mx = e.clientX - rootRect.left;
    const my = e.clientY - rootRect.top;
    dragLine.setAttribute("x2", String(mx));
    dragLine.setAttribute("y2", String(my));

    // highlight entry under cursor (skip self)
    const el = document.elementFromPoint(e.clientX, e.clientY);
    let entry = el?.closest(".entry") as HTMLElement | null;
    const sourceEntry = dragSourceEl?.closest(".entry") as HTMLElement | null;
    if (entry && entry === sourceEntry) entry = null;

    const obs = (view as any).domObserver;
    obs?.stop?.();
    if (hoveredEntry && hoveredEntry !== entry) {
      hoveredEntry.classList.remove("connect-target");
    }
    if (entry && entry !== hoveredEntry) {
      entry.classList.add("connect-target");
    }
    obs?.start?.();
    hoveredEntry = entry;
  }

  function onDragEnd(e: MouseEvent) {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);

    const obs = (view as any).domObserver;
    if (hoveredEntry) {
      obs?.stop?.();
      hoveredEntry.classList.remove("connect-target");
      obs?.start?.();
      const targetId = hoveredEntry.dataset.entryId;

      if (targetId && dragSourceEl) {
        const sourceEntry = dragSourceEl.closest(".entry") as HTMLElement | null;
        const sourceId = sourceEntry?.dataset.entryId;
        if (targetId !== sourceId) {
          const pos = view.posAtDOM(dragSourceEl, 0);
          const $pos = view.state.doc.resolve(pos);
          const nodePos = $pos.before($pos.depth);
          const node = $pos.parent;

          const tr = view.state.tr.setNodeMarkup(nodePos, null, {
            ...node.attrs,
            next: targetId,
          });
          view.dispatch(tr);
        }
      }
    }

    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
    dragLine = null;
    dragSourceEl = null;
    hoveredEntry = null;
    requestAnimationFrame(() => refresh(view));
  }
}

function setupDragDrop(view: EditorView) {
  const dom = view.dom;
  let dragSource: HTMLElement | null = null;
  let dragType: "choice" | "entry" | null = null;
  let dropAfter = false;

  dom.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement;

    // choice drag via handle
    const handle = target.closest(".drag-handle");
    if (handle) {
      dragSource = handle.closest(".choice") as HTMLElement;
      dragType = "choice";
    } else {
      // entry drag via char-name
      const charName = target.closest(".char-name");
      if (charName) {
        dragSource = charName.closest(".entry") as HTMLElement;
        dragType = "entry";
      }
    }

    if (!dragSource) return;
    customDragActive = true;
    e.dataTransfer!.effectAllowed = "move";
    const obs = (view as any).domObserver;
    obs?.stop?.();
    dragSource.classList.add("dragging");
    obs?.start?.();
  });

  // the element whose border-top is showing the drop indicator
  let indicatorEl: HTMLElement | null = null;
  let insertAfterIndicator = false; // only true for "after last element"

  dom.addEventListener("dragover", (e) => {
    if (!dragSource || !dragType) return;

    const selector = dragType === "choice" ? ".choice" : ".entry";
    const isHidden = (el: Element) =>
      dragType === "choice"
        ? el.classList.contains("choice-dimmed")
        : el.classList.contains("entry-hidden");
    const skipSibling = (n: Element) =>
      n === dragSource || !n.matches(selector) || isHidden(n);
    const nextVisible = (el: Element): Element | null => {
      let n = el.nextElementSibling;
      while (n && (!n.matches(selector) || isHidden(n))) n = n.nextElementSibling;
      return n;
    };
    const prevVisible = (el: Element): Element | null => {
      let n = el.previousElementSibling;
      while (n && (!n.matches(selector) || isHidden(n))) n = n.previousElementSibling;
      return n;
    };

    let el = (e.target as HTMLElement).closest(selector) as HTMLElement;

    // skip hidden elements found by closest
    if (el && isHidden(el)) el = null as any;

    // for choices, reject if hovering a different decision node
    if (el && dragType === "choice" && el.parentElement !== dragSource.parentElement) {
      clearIndicators();
      return;
    }

    // if cursor is in the gap between elements, find the nearest sibling
    if (!el) {
      // scope search to the same parent container as the drag source
      const container =
        dragType === "choice"
          ? dragSource.parentElement!
          : dom;
      const all = [
        ...container.querySelectorAll<HTMLElement>(`:scope > ${selector}`),
      ].filter((n) => n !== dragSource && !isHidden(n));
      if (!all.length) return;
      for (const candidate of all) {
        const rect = candidate.getBoundingClientRect();
        if (e.clientY <= rect.bottom) {
          el = candidate;
          break;
        }
      }
      if (!el) el = all[all.length - 1];
    }

    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    obs?.stop?.();
    dom.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((ind) =>
      ind.classList.remove("drag-over-top", "drag-over-bottom"),
    );

    const rect = el.getBoundingClientRect();
    const inBottomHalf = e.clientY > rect.top + rect.height / 2;

    // when over the drag source or the bottom half of any element,
    // redirect the indicator to a neighbor
    if (el === dragSource ? inBottomHalf : inBottomHalf) {
      // show "before next sibling"
      let next = el.nextElementSibling;
      while (next && skipSibling(next))
        next = next.nextElementSibling;
      if (next) {
        indicatorEl = next as HTMLElement;
        insertAfterIndicator = false;
        indicatorEl.classList.add("drag-over-top");
      } else if (el !== dragSource) {
        // no next sibling — show "after last element"
        indicatorEl = el;
        insertAfterIndicator = true;
        indicatorEl.classList.add("drag-over-bottom");
      }
    } else if (el === dragSource) {
      // top half of drag source — show "before" it, i.e. top of previous sibling's next
      // which is just "top of drag source position" = find previous sibling and show bottom
      let prev = el.previousElementSibling;
      while (prev && skipSibling(prev))
        prev = prev.previousElementSibling;
      if (prev) {
        indicatorEl = prev as HTMLElement;
        insertAfterIndicator = true;
        indicatorEl.classList.add("drag-over-bottom");
      } else {
        // drag source is first — show top on the next sibling
        let next = el.nextElementSibling;
        while (next && skipSibling(next))
          next = next.nextElementSibling;
        if (next) {
          indicatorEl = next as HTMLElement;
          insertAfterIndicator = false;
          indicatorEl.classList.add("drag-over-top");
        }
      }
    } else {
      indicatorEl = el;
      insertAfterIndicator = false;
      el.classList.add("drag-over-top");
    }

    // suppress indicator if drop would be a no-op
    if (indicatorEl) {
      const isNoOp = insertAfterIndicator
        ? nextVisible(indicatorEl) === dragSource
        : prevVisible(indicatorEl) === dragSource || indicatorEl === nextVisible(dragSource);
      if (isNoOp) {
        indicatorEl.classList.remove("drag-over-top", "drag-over-bottom");
        indicatorEl = null;
      }
    }

    obs?.start?.();
  });

  dom.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragSource || !dragType || !indicatorEl) {
      cleanup();
      return;
    }

    const sourcePos = view.posAtDOM(dragSource, 0);
    const targetPos = view.posAtDOM(indicatorEl, 0);
    const $source = view.state.doc.resolve(sourcePos);
    const $target = view.state.doc.resolve(targetPos);

    // find the parent container depth
    const nodeType = dragType === "choice" ? "decision" : "doc";
    let parentDepth = $source.depth;
    while (parentDepth > 0 && $source.node(parentDepth).type.name !== nodeType) {
      parentDepth--;
    }
    if (dragType === "choice" && parentDepth === 0) {
      cleanup();
      return;
    }

    // ensure both are in the same parent
    if (
      parentDepth > 0 &&
      $source.before(parentDepth) !== $target.before(parentDepth)
    ) {
      cleanup();
      return;
    }

    const sourceIndex = $source.index(parentDepth);
    let targetIndex = $target.index(parentDepth);
    // indicator is always "insert before indicatorEl", except at the very end
    if (insertAfterIndicator) {
      if (targetIndex < sourceIndex) targetIndex++;
    } else {
      if (targetIndex > sourceIndex) targetIndex--;
    }
    if (sourceIndex === targetIndex) {
      cleanup();
      return;
    }

    const parentNode = $source.node(parentDepth);
    const children: PMNode[] = [];
    parentNode.forEach((child) => children.push(child));

    const [moved] = children.splice(sourceIndex, 1);
    children.splice(targetIndex, 0, moved);

    const contentStart = $source.start(parentDepth);
    const contentEnd = $source.end(parentDepth);

    const tr = view.state.tr;
    tr.replaceWith(contentStart, contentEnd, children);
    view.dispatch(tr);

    cleanup();
    requestAnimationFrame(() => refresh(view));
  });

  dom.addEventListener("dragend", cleanup);

  // handle dragging above the editor (over toolbar etc.)
  document.addEventListener("dragover", (e) => {
    if (!dragSource || dragType !== "entry") return;
    // only act when cursor is above the editor
    const editorTop = dom.getBoundingClientRect().top;
    if (e.clientY >= editorTop) return;

    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    const obs = (view as any).domObserver;
    obs?.stop?.();
    dom.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((ind) =>
      ind.classList.remove("drag-over-top", "drag-over-bottom"),
    );

    // find first visible entry
    const first = dom.querySelector<HTMLElement>(".entry:not(.entry-hidden):not(.dragging)");
    if (first && first !== dragSource) {
      indicatorEl = first;
      insertAfterIndicator = false;
      first.classList.add("drag-over-top");
    }
    obs?.start?.();
  });

  document.addEventListener("drop", (e) => {
    if (!dragSource || dragType !== "entry" || !indicatorEl) return;
    const editorTop = dom.getBoundingClientRect().top;
    if (e.clientY >= editorTop) return;
    // forward to the dom drop handler by dispatching a synthetic event
    e.preventDefault();
    dom.dispatchEvent(new DragEvent("drop", { bubbles: true }));
  });

  const obs = (view as any).domObserver;

  function clearIndicators() {
    obs?.stop?.();
    dom.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((el) =>
      el.classList.remove("drag-over-top", "drag-over-bottom"),
    );
    indicatorEl = null;
    obs?.start?.();
  }

  function cleanup() {
    customDragActive = false;
    obs?.stop?.();
    dom
      .querySelectorAll(".dragging, .drag-over-top, .drag-over-bottom")
      .forEach((el) => {
        el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
      });
    obs?.start?.();
    dragSource = null;
    dragType = null;
  }
}

function getEntrypoints(root: HTMLElement): string[] {
  const allNextTargets = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-next]").forEach((el) => {
    allNextTargets.add(el.dataset.next!);
  });
  const ids: string[] = [];
  root.querySelectorAll<HTMLElement>(".entry[data-entry-id]").forEach((entry) => {
    const id = entry.dataset.entryId!;
    if (!allNextTargets.has(id)) ids.push(id);
  });
  return ids;
}

function walkGraph(root: HTMLElement, startIds: string[], respectChecks = true): Set<string> {
  const reachable = new Set<string>();

  function walk(entryId: string) {
    if (reachable.has(entryId)) return;
    reachable.add(entryId);

    const entry = root.querySelector<HTMLElement>(
      `.entry[data-entry-id="${entryId}"]`,
    );
    if (!entry) return;

    const dialogue = entry.querySelector<HTMLElement>(".dialogue[data-next]");
    if (dialogue) {
      walk(dialogue.dataset.next!);
      return;
    }

    const decision = entry.querySelector(".decision");
    if (decision) {
      const checked = decision.querySelectorAll<HTMLElement>(
        ".choice[data-checked]",
      );
      if (respectChecks && checked.length > 0) {
        checked.forEach((choice) => {
          if (choice.dataset.next) walk(choice.dataset.next);
        });
      } else {
        decision
          .querySelectorAll<HTMLElement>(".choice[data-next]")
          .forEach((choice) => {
            walk(choice.dataset.next!);
          });
      }
    }
  }

  startIds.forEach((id) => walk(id));
  return reachable;
}

function updateVisibility(root: HTMLElement) {
  const entries = root.querySelectorAll<HTMLElement>(".entry[data-entry-id]");
  const hasAnyChecks =
    root.querySelector<HTMLElement>(".choice[data-checked]") !== null;

  // reset
  entries.forEach((e) => e.classList.remove("entry-hidden", "entry-detached"));
  root
    .querySelectorAll(".choice")
    .forEach((e) => e.classList.remove("choice-dimmed"));

  // gray out unchecked choices in decisions that have at least one check
  if (hasAnyChecks) {
    root.querySelectorAll(".decision").forEach((decision) => {
      const checked = decision.querySelectorAll(".choice[data-checked]");
      if (checked.length > 0) {
        decision.querySelectorAll(".choice").forEach((choice) => {
          if (!choice.hasAttribute("data-checked")) choice.classList.add("choice-dimmed");
        });
      }
    });
  }

  // determine which roots to walk from
  const rootIds = filterEntrypoint ? [filterEntrypoint] : getEntrypoints(root);

  // always walk the graph when filtering, even without checks
  if (!hasAnyChecks && !filterEntrypoint) return;

  const reachable = walkGraph(root, rootIds);

  // full subgraph ignoring checkboxes — used for pinning & detached display
  const fullSubgraph = filterEntrypoint && hasAnyChecks
    ? walkGraph(root, rootIds, false)
    : reachable;

  // auto-pin full subgraph entries so remote additions stick
  if (filterEntrypoint) {
    for (const id of fullSubgraph) pinnedEntries.add(id);
  }

  entries.forEach((entry) => {
    const id = entry.dataset.entryId!;
    if (reachable.has(id)) return;

    if (fullSubgraph.has(id) || !pinnedEntries.has(id)) {
      // in subgraph but checkbox-filtered, or not pinned at all → hide
      entry.classList.add("entry-hidden");
    } else {
      // pinned but not in subgraph (newly created / disconnected) → gray out
      entry.classList.add("entry-detached");
    }
  });
}

function labelEntrypoints(root: HTMLElement) {
  // remove old labels
  root.querySelectorAll(".entrypoint-label").forEach((el) => el.remove());

  // find entries not targeted by any next
  const allNextTargets = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-next]").forEach((el) => {
    allNextTargets.add(el.dataset.next!);
  });

  root.querySelectorAll<HTMLElement>(".entry[data-entry-id]").forEach((entry) => {
    const id = entry.dataset.entryId!;
    if (allNextTargets.has(id)) return;
    const charName = entry.querySelector(".char-name");
    if (!charName) return;
    const label = document.createElement("span");
    label.className = "entrypoint-label";
    label.textContent = id;
    charName.insertBefore(label, charName.firstChild);
  });
}

function updateFilterDropdown(root: HTMLElement) {
  const entrypoints = getEntrypoints(root);
  const current = filterSelect.value;
  // clear all but the "All" option
  while (filterSelect.options.length > 1) filterSelect.remove(1);
  for (const id of entrypoints) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    filterSelect.appendChild(opt);
  }
  // restore selection if still valid, otherwise reset
  if (current && entrypoints.includes(current)) {
    filterSelect.value = current;
  } else if (current) {
    filterSelect.value = "";
    filterEntrypoint = null;
  }
}

function refresh(view: EditorView) {
  // suppress ProseMirror's DOM observer while we modify classes/labels
  const obs = (view as any).domObserver;
  obs?.stop?.();
  updateFilterDropdown(view.dom);
  updateVisibility(view.dom);
  labelEntrypoints(view.dom);
  obs?.start?.();
  drawArrows(view);
}

// --- Ctrl+Enter: create new entry below ---

let activeNameInput: HTMLInputElement | null = null;

function findEntryPosByID(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let result: { pos: number; node: PMNode } | null = null;
  doc.forEach((child, off) => {
    if (!result && child.type.name === "entry" && child.attrs.id === id) {
      result = { pos: off, node: child };
    }
  });
  return result;
}

function removeEntry(view: EditorView, id: string) {
  const found = findEntryPosByID(view.state.doc, id);
  if (!found) return;
  let tr = view.state.tr.delete(found.pos, found.pos + found.node.nodeSize);
  // disconnect any nodes that link to the deleted entry
  tr.doc.descendants((node, pos) => {
    if (
      (node.type.name === "dialogue" || node.type.name === "choice") &&
      node.attrs.next === id
    ) {
      tr = tr.setNodeMarkup(pos, null, { ...node.attrs, next: null });
    }
  });
  view.dispatch(tr);
}

function finalizeDialogue(view: EditorView, id: string, charName: string, sourceEntryId?: string) {
  const found = findEntryPosByID(view.state.doc, id);
  if (!found) return;
  // replace the dialogue node entirely so ProseMirror re-renders the char-name text
  const dialoguePos = found.pos + 1;
  const dialogueNode = found.node.firstChild!;
  const newDialogue = scriptSchema.nodes.dialogue.create(
    { ...dialogueNode.attrs, char: charName },
    dialogueNode.content,
  );
  let tr = view.state.tr.replaceWith(dialoguePos, dialoguePos + dialogueNode.nodeSize, newDialogue);

  // auto-link: if created from a dialogue node, set that dialogue's next to this entry
  if (sourceEntryId) {
    const sourceFound = findEntryPosByID(tr.doc, sourceEntryId);
    if (sourceFound) {
      const sourceInner = sourceFound.node.firstChild!;
      if (sourceInner.type.name === "dialogue") {
        const sourceDialoguePos = sourceFound.pos + 1;
        tr = tr.setNodeMarkup(sourceDialoguePos, null, { ...sourceInner.attrs, next: id });
      }
    }
  }

  view.dispatch(tr);
  // focus the first line in the new entry
  requestAnimationFrame(() => {
    const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
    const lineEl = entryEl?.querySelector(".line");
    if (lineEl) {
      const pos = view.posAtDOM(lineEl, 0);
      const tr2 = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
      view.dispatch(tr2);
      view.focus();
    }
  });
}

function convertToDecision(view: EditorView, id: string, sourceEntryId?: string) {
  const found = findEntryPosByID(view.state.doc, id);
  if (!found) return;
  // replace the dialogue node with a decision node containing one empty choice
  const dialoguePos = found.pos + 1;
  const dialogueNode = found.node.firstChild!;
  const decision = scriptSchema.nodes.decision.create(null, [
    scriptSchema.nodes.choice.create(null),
  ]);
  let tr = view.state.tr.replaceWith(dialoguePos, dialoguePos + dialogueNode.nodeSize, decision);

  // auto-link: if created from a dialogue node, set that dialogue's next to this entry
  if (sourceEntryId) {
    const sourceFound = findEntryPosByID(tr.doc, sourceEntryId);
    if (sourceFound) {
      const sourceInner = sourceFound.node.firstChild!;
      if (sourceInner.type.name === "dialogue") {
        const sourceDialoguePos = sourceFound.pos + 1;
        tr = tr.setNodeMarkup(sourceDialoguePos, null, { ...sourceInner.attrs, next: id });
      }
    }
  }

  view.dispatch(tr);
  // focus the first choice-text in the new entry
  requestAnimationFrame(() => {
    const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
    const choiceText = entryEl?.querySelector(".choice-text");
    if (choiceText) {
      const pos = view.posAtDOM(choiceText, 0);
      const tr2 = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
      view.dispatch(tr2);
      view.focus();
    }
  });
}

function showNameInput(view: EditorView, id: string, sourceEntryId?: string) {
  // find the char-name element for this entry
  const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
  if (!entryEl) return;
  const charNameEl = entryEl.querySelector(".char-name") as HTMLElement;
  if (!charNameEl) return;

  const input = document.createElement("input");
  input.className = "char-name-input";
  input.placeholder = "CHARACTER";
  input.type = "text";

  // position over the char-name element
  function positionInput() {
    const wrapperRect = overlay.parentElement!.getBoundingClientRect();
    const charRect = charNameEl.getBoundingClientRect();
    input.style.position = "absolute";
    input.style.left = charRect.left - wrapperRect.left + "px";
    input.style.top = charRect.top - wrapperRect.top + "px";
    input.style.width = charRect.width + "px";
    input.style.height = charRect.height + "px";
  }
  positionInput();

  overlay.appendChild(input);
  activeNameInput = input;
  input.focus();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const value = input.value.trim().toUpperCase();
    // defer cleanup so the input stays in the DOM through the keydown event,
    // preventing focus from falling to ProseMirror and re-dispatching Enter
    requestAnimationFrame(() => {
      cleanup();
      if (!value) {
        removeEntry(view, id);
        view.focus();
        return;
      }
      if (value === "PLAYER") {
        convertToDecision(view, id, sourceEntryId);
      } else {
        finalizeDialogue(view, id, value, sourceEntryId);
      }
    });
  }

  function cancel() {
    if (committed) return;
    committed = true;
    cleanup();
    removeEntry(view, id);
    view.focus();
  }

  function cleanup() {
    input.remove();
    activeNameInput = null;
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!committed) cancel();
    }, 0);
  });
}

function createEntryBelow(state: EditorState, dispatch?: (tr: any) => void, view?: EditorView) {
  if (activeNameInput) return false;

  const { $from } = state.selection;
  // walk up to find the entry node
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== "entry") depth--;
  if (depth === 0) return false;

  if (dispatch && view) {
    const insertPos = $from.after(depth);
    const newId = generateEntryId();
    pinnedEntries.add(newId);
    const newEntry = scriptSchema.nodes.entry.create(
      { id: newId },
      scriptSchema.nodes.dialogue.create(
        { char: "" },
        scriptSchema.nodes.line.create(),
      ),
    );
    let tr = state.tr.insert(insertPos, newEntry);

    // auto-link from decision choices
    const entryNode = $from.node(depth);
    const inner = entryNode.firstChild;
    if (inner && inner.type.name === "decision") {
      // find the choice the cursor is in
      let choiceDepth = $from.depth;
      while (choiceDepth > 0 && $from.node(choiceDepth).type.name !== "choice") choiceDepth--;
      const cursorChoice = choiceDepth > 0 ? $from.node(choiceDepth) : null;

      let linked = false;
      // if cursor is in an unchecked choice with no connection, link that choice
      if (cursorChoice && !cursorChoice.attrs.checked && !cursorChoice.attrs.next) {
        const choicePos = $from.before(choiceDepth);
        tr = tr.setNodeMarkup(choicePos, null, { ...cursorChoice.attrs, next: newId });
        linked = true;
      }

      // otherwise, if exactly 1 checked choice, link that
      if (!linked) {
        const checkedChoices: { offset: number; node: PMNode }[] = [];
        inner.forEach((child, offset) => {
          if (child.type.name === "choice" && child.attrs.checked) {
            checkedChoices.push({ offset, node: child });
          }
        });
        if (checkedChoices.length === 1) {
          const entryPos = $from.before(depth);
          const choicePos = entryPos + 1 + 1 + checkedChoices[0].offset;
          tr = tr.setNodeMarkup(choicePos, null, { ...checkedChoices[0].node.attrs, next: newId });
        }
      }
    }

    const sourceEntryNode = $from.node(depth);
    const sourceInner = sourceEntryNode.firstChild;
    const sourceId = sourceInner?.type.name === "dialogue" ? sourceEntryNode.attrs.id : undefined;

    dispatch(tr);
    requestAnimationFrame(() => showNameInput(view, newId, sourceId));
  }
  return true;
}

function buildNodeJson(view: EditorView, charNameEl: HTMLElement): {
  json: Record<string, any>;
  entryPos: number;
  nodePos: number;
  nodeType: "dialogue" | "decision";
  entryNode: PMNode;
  innerNode: PMNode;
} | null {
  const pos = view.posAtDOM(charNameEl, 0);
  const $pos = view.state.doc.resolve(pos);

  // walk up to find entry depth
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== "entry") depth--;
  if (depth === 0) return null;

  const entryNode = $pos.node(depth);
  const entryPos = $pos.before(depth);
  const innerNode = entryNode.firstChild!;
  const nodePos = entryPos + 1;

  if (innerNode.type.name === "dialogue") {
    const a = innerNode.attrs;
    const json: Record<string, any> = { id: entryNode.attrs.id, char: a.char };
    // extract text from line children — always array of objects
    const textArr: Record<string, any>[] = [];
    innerNode.forEach((line) => {
      const obj: Record<string, any> = { text: line.textContent };
      if (line.attrs.trigger) obj.trigger = line.attrs.trigger;
      if (line.attrs.extra) Object.assign(obj, line.attrs.extra);
      textArr.push(obj);
    });
    json.text = textArr;
    if (a.delay !== null) json.delay = a.delay;
    if (a.next !== null) json.next = a.next;
    if (a.trigger !== null) json.trigger = a.trigger;
    if (a.unskippable) json.unskippable = a.unskippable;
    if (a.randomize) json.randomize = a.randomize;
    if (a.extra) Object.assign(json, a.extra);
    return { json, entryPos, nodePos, nodeType: "dialogue", entryNode, innerNode };
  } else if (innerNode.type.name === "decision") {
    const json: Record<string, any> = { id: entryNode.attrs.id };
    // extract input from choice children
    const inputArr: any[] = [];
    innerNode.forEach((choice) => {
      const obj: Record<string, any> = { text: choice.textContent };
      if (choice.attrs.next) obj.next = choice.attrs.next;
      if (choice.attrs.effect) obj.effect = choice.attrs.effect;
      if (choice.attrs.cond) obj.cond = choice.attrs.cond;
      if (choice.attrs.extra) Object.assign(obj, choice.attrs.extra);
      inputArr.push(obj);
    });
    json.input = inputArr;
    if (innerNode.attrs.extra) Object.assign(json, innerNode.attrs.extra);
    return { json, entryPos, nodePos, nodeType: "decision", entryNode, innerNode };
  }
  return null;
}

function dismissJsonEditor(view: EditorView) {
  if (!activeJsonEditor) return;
  activeJsonEditor.cmView.destroy();
  activeJsonEditor.popup.remove();
  activeJsonEditor.cleanup();
  activeJsonEditor = null;
  collab.provider.awareness.setLocalStateField("editing", null);
  view.focus();
}

function closeJsonEditor(view: EditorView) {
  if (!activeJsonEditor) return;
  // auto-save: attempt to apply, silently discard on parse error
  activeJsonEditor.save();
  dismissJsonEditor(view);
}

function openJsonEditor(view: EditorView, charNameEl: HTMLElement) {
  const entryEl = charNameEl.closest(".entry") as HTMLElement | null;
  const clickedEntryId = entryEl?.dataset.entryId ?? null;
  if (activeJsonEditor) {
    const same = clickedEntryId !== null && activeJsonEditor.entryId === clickedEntryId;
    closeJsonEditor(view);
    if (same) return;
  }

  const dataOrNull = buildNodeJson(view, charNameEl);
  if (!dataOrNull) return;
  const data = dataOrNull;

  const popup = document.createElement("div");
  popup.className = "json-editor-popup";

  const cmContainer = document.createElement("div");
  cmContainer.className = "json-editor-cm";
  popup.appendChild(cmContainer);

  const actions = document.createElement("div");
  actions.className = "json-editor-actions";

  const errorSpan = document.createElement("span");
  errorSpan.className = "json-editor-error";
  actions.appendChild(errorSpan);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "json-editor-cancel";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);

  popup.appendChild(actions);

  // position below char-name
  const wrapperRect = overlay.parentElement!.getBoundingClientRect();
  const charRect = charNameEl.getBoundingClientRect();
  popup.style.position = "absolute";
  popup.style.left = (charRect.left - wrapperRect.left) + "px";
  popup.style.top = (charRect.bottom - wrapperRect.top + 4) + "px";
  popup.style.width = charRect.width + "px";

  overlay.appendChild(popup);

  const jsonStr = JSON.stringify(data.json, null, 2);

  function doSave() {
    if (!activeJsonEditor) return;
    const text = activeJsonEditor.cmView.state.doc.toString();
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      notyf.error(`Invalid JSON: ${(e as SyntaxError).message}`);
      return;
    }

    const { id, ...rest } = parsed;
    let tr = view.state.tr;

    // update entry id and all next references if changed
    const oldId = data.entryNode.attrs.id;
    if (id !== undefined && id !== oldId) {
      // check for duplicate ID
      let duplicate = false;
      view.state.doc.forEach((node) => {
        if (node.type.name === "entry" && node.attrs.id === id) duplicate = true;
      });
      if (duplicate) {
        notyf.error(`ID "${id}" already exists`);
        return;
      }

      tr = tr.setNodeMarkup(data.entryPos, null, { ...data.entryNode.attrs, id });
      // update all dialogue/choice nodes whose next points to the old id
      tr.doc.descendants((node, pos) => {
        if (
          (node.type.name === "dialogue" || node.type.name === "choice") &&
          node.attrs.next === oldId
        ) {
          tr = tr.setNodeMarkup(pos, null, { ...node.attrs, next: id });
        }
      });
    }

    if (data.nodeType === "dialogue") {
      const { char, delay, next, trigger, unskippable, randomize, text, ...extra } = rest;
      const newAttrs = {
        char: char ?? data.innerNode.attrs.char,
        delay: delay ?? null,
        next: next ?? null,
        trigger: trigger ?? null,
        unskippable: unskippable ?? false,
        randomize: randomize ?? false,
        extra: Object.keys(extra).length > 0 ? extra : null,
      };
      // rebuild line nodes from text field
      let content = data.innerNode.content;
      if (text !== undefined) {
        const textArray = Array.isArray(text) ? text : [text];
        const lineNodes = textArray.map((l: any) => {
          if (typeof l === "string") {
            return scriptSchema.nodes.line.create(null, l ? scriptSchema.text(l) : undefined);
          }
          const { text: lt, trigger: ltrig, ...lineExtra } = l;
          return scriptSchema.nodes.line.create(
            {
              trigger: ltrig ?? null,
              extra: Object.keys(lineExtra).length > 0 ? lineExtra : null,
            },
            lt ? scriptSchema.text(lt) : undefined,
          );
        });
        content = scriptSchema.nodes.dialogue.createChecked(newAttrs, lineNodes).content;
      }
      // must use replaceWith to re-render char-name text
      const newDialogue = scriptSchema.nodes.dialogue.create(newAttrs, content);
      const mappedNodePos = tr.mapping.map(data.nodePos);
      const mappedNodeEnd = tr.mapping.map(data.nodePos + data.innerNode.nodeSize);
      tr = tr.replaceWith(mappedNodePos, mappedNodeEnd, newDialogue);
    } else if (data.nodeType === "decision") {
      const { input, ...extra } = rest;
      const extraAttr = Object.keys(extra).length > 0 ? extra : null;
      // rebuild choice nodes from input field
      let content = data.innerNode.content;
      if (input !== undefined && Array.isArray(input)) {
        const choiceNodes = input.map((c: any) => {
          const { text: ct, next: cn, effect: ce, cond: cc, checked: ck, ...choiceExtra } = c;
          return scriptSchema.nodes.choice.create(
            {
              next: cn ?? null,
              effect: ce ?? null,
              cond: cc ?? null,
              checked: ck ?? false,
              extra: Object.keys(choiceExtra).length > 0 ? choiceExtra : null,
            },
            ct ? scriptSchema.text(ct) : undefined,
          );
        });
        content = scriptSchema.nodes.decision.createChecked({ extra: extraAttr }, choiceNodes).content;
      }
      const newDecision = scriptSchema.nodes.decision.create({ extra: extraAttr }, content);
      const mappedNodePos = tr.mapping.map(data.nodePos);
      const mappedNodeEnd = tr.mapping.map(data.nodePos + data.innerNode.nodeSize);
      tr = tr.replaceWith(mappedNodePos, mappedNodeEnd, newDecision);
    }

    view.dispatch(tr);
    requestAnimationFrame(() => refresh(view));
  }

  const cmView = new CMEditorView({
    parent: cmContainer,
    state: CMEditorState.create({
      doc: jsonStr,
      extensions: [
        basicSetup,
        jsonLang(),
        oneDark,
        cmKeymap.of([
          {
            key: "Escape",
            run: () => { dismissJsonEditor(view); return true; },
          },
        ]),
        CMEditorView.theme({
          "&": { fontSize: "13px" },
        }),
      ],
    }),
  });

  // click outside to close (auto-saves) — skip char-name-link clicks, those toggle via mouseup
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!popup.contains(target) && !target.closest(".char-name-link")) {
      closeJsonEditor(view);
    }
  }
  // delay so the current click doesn't immediately close it
  requestAnimationFrame(() => {
    document.addEventListener("mousedown", handleClickOutside, true);
  });

  cancelBtn.addEventListener("click", () => dismissJsonEditor(view));

  cmView.focus();

  activeJsonEditor = {
    popup,
    cmView,
    entryId: data.entryNode.attrs.id,
    save: doSave,
    cleanup: () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    },
  };
  collab.provider.awareness.setLocalStateField("editing", data.entryNode.attrs.id);
}

function selectBlock(state: EditorState, dispatch?: (tr: any) => void) {
  const { $from } = state.selection;
  // find the nearest text-containing parent (line or choice)
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  if (depth === 0) return false;
  if (dispatch) {
    const start = $from.start(depth);
    const end = $from.end(depth);
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
  }
  return true;
}

let refreshPending = false;
function scheduleRefresh(v: EditorView) {
  if (refreshPending) return;
  refreshPending = true;
  requestAnimationFrame(() => {
    refreshPending = false;
    refresh(v);
  });
}

// Export document to JSON
function docToJson(doc: PMNode): Record<string, any> {
  const result: Record<string, any> = {};
  doc.forEach((entry) => {
    const id = entry.attrs.id;
    const inner = entry.firstChild!;

    if (inner.type.name === "dialogue") {
      const a = inner.attrs;
      const node: Record<string, any> = { char: a.char };
      const textArr: any[] = [];
      inner.forEach((line) => {
        const obj: Record<string, any> = { text: line.textContent };
        if (line.attrs.trigger) obj.trigger = line.attrs.trigger;
        if (line.attrs.extra) Object.assign(obj, line.attrs.extra);
        // simplify single-key {text} objects to plain strings
        if (Object.keys(obj).length === 1) {
          textArr.push(obj.text);
        } else {
          textArr.push(obj);
        }
      });
      node.text = textArr.length === 1 ? textArr[0] : textArr;
      if (a.delay !== null) node.delay = a.delay;
      if (a.next !== null) node.next = a.next;
      if (a.trigger !== null) node.trigger = a.trigger;
      if (a.unskippable) node.unskippable = a.unskippable;
      if (a.randomize) node.randomize = a.randomize;
      if (a.extra) Object.assign(node, a.extra);
      result[id] = node;
    } else if (inner.type.name === "decision") {
      const inputArr: any[] = [];
      inner.forEach((choice) => {
        const obj: Record<string, any> = { text: choice.textContent };
        if (choice.attrs.next) obj.next = choice.attrs.next;
        if (choice.attrs.effect) obj.effect = choice.attrs.effect;
        if (choice.attrs.cond) obj.cond = choice.attrs.cond;
        if (choice.attrs.extra) Object.assign(obj, choice.attrs.extra);
        inputArr.push(obj);
      });
      const node: Record<string, any> = { input: inputArr };
      if (inner.attrs.extra) Object.assign(node, inner.attrs.extra);
      result[id] = node;
    }
  });
  return result;
}

// Subgraph filter
let filterEntrypoint: string | null = null;
const pinnedEntries = new Set<string>();
const filterSelect = document.createElement("select");
filterSelect.className = "subgraph-filter";
const allOption = document.createElement("option");
allOption.value = "";
allOption.textContent = "All entrypoints";
filterSelect.appendChild(allOption);
filterSelect.addEventListener("change", () => {
  filterEntrypoint = filterSelect.value || null;
  pinnedEntries.clear();
  if (filterEntrypoint && view) {
    for (const id of walkGraph(view.dom, [filterEntrypoint], false)) {
      pinnedEntries.add(id);
    }
  }
  if (view) requestAnimationFrame(() => refresh(view));
});
const toolbar = document.createElement("div");
toolbar.className = "toolbar";
toolbar.appendChild(filterSelect);

const exportBtn = document.createElement("button");
exportBtn.className = "export-btn";
exportBtn.textContent = "Export JSON";
exportBtn.addEventListener("click", () => {
  if (!view) return;
  const json = docToJson(view.state.doc);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "script.json";
  a.click();
  URL.revokeObjectURL(url);
});
toolbar.appendChild(exportBtn);

document.querySelector("#app")!.appendChild(toolbar);

// DOM setup (synchronous — doesn't depend on Y.Doc)
const wrapper = document.createElement("div");
wrapper.style.position = "relative";
document.querySelector("#app")!.appendChild(wrapper);

overlay = document.createElement("div");
overlay.style.position = "absolute";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100%";
overlay.style.height = "100%";
overlay.style.pointerEvents = "none";

let view: EditorView;

// Wait for initial Yjs sync before creating the editor
collab.provider.on("sync", (synced: boolean) => {
  if (!synced || view) return;

  // Seed the Y.Doc on first load (empty document)
  if (collab.yXmlFragment.length === 0) {
    const pmDoc = linesToDoc(lines);
    const tempYDoc = prosemirrorJSONToYDoc(scriptSchema, pmDoc.toJSON());
    const update = Y.encodeStateAsUpdate(tempYDoc);
    Y.applyUpdate(collab.ydoc, update);
    tempYDoc.destroy();
  }

  const editorState = EditorState.create({
    schema: scriptSchema,
    plugins: [
      ...collab.plugins,
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Mod-Shift-z": redo,
        "Mod-a": selectBlock,
        "Mod-Enter": createEntryBelow,
      }),
      keymap(baseKeymap),
    ],
  });

  view = new EditorView(wrapper, {
    state: editorState,
    handleDOMEvents: {
      mousedown(pmView, event) {
        const target = event.target as HTMLElement;
        const charNameEl = target.closest(".char-name") as HTMLElement | null;
        if (charNameEl) {
          // only track for JSON editor if clicking the link text itself
          if (target.closest(".char-name-link")) {
            charNameMousedown = { x: event.clientX, y: event.clientY, target: charNameEl };
          }
          return true;
        }
        if (target.closest(".drag-handle")) {
          return true;
        }
        // clicks outside editable text (badges, padding, etc.) → place cursor
        // at end of whichever choice/line the click Y overlaps
        if (!target.closest(".choice-text") && !target.closest(".dialogue-lines .line") && !target.closest(".choice-checkbox")) {
          const y = event.clientY;
          const candidates = pmView.dom.querySelectorAll<HTMLElement>(".choice, .dialogue-lines .line");
          for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (y >= rect.top && y <= rect.bottom) {
              const textEl = el.classList.contains("choice")
                ? el.querySelector(".choice-text")
                : el;
              if (textEl) {
                event.preventDefault();
                const pos = pmView.posAtDOM(textEl, textEl.childNodes.length);
                const tr = pmView.state.tr.setSelection(TextSelection.create(pmView.state.doc, pos));
                pmView.dispatch(tr);
                pmView.focus();
                return true;
              }
            }
          }
        }
        return false;
      },
      mouseup(pmView, event) {
        if (charNameMousedown) {
          const dx = event.clientX - charNameMousedown.x;
          const dy = event.clientY - charNameMousedown.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const tgt = charNameMousedown.target;
          charNameMousedown = null;
          if (dist < 5) {
            openJsonEditor(pmView, tgt);
            return true;
          }
        }
        return false;
      },
      dragstart(_view, event) {
        charNameMousedown = null;
        const target = event.target as HTMLElement;
        if (target.closest(".drag-handle") || target.closest(".char-name")) {
          return true;
        }
        return false;
      },
      dragover() {
        return customDragActive;
      },
      drop() {
        return customDragActive;
      },
      dragend() {
        return customDragActive;
      },
    },
    dispatchTransaction(this: EditorView, tr) {
      const oldState = this.state;
      const newState = oldState.apply(tr);
      this.updateState(newState);

      // clean up dangling next references when entries are deleted
      if (tr.docChanged) {
        const oldIds = new Set<string>();
        oldState.doc.forEach((node) => {
          if (node.type.name === "entry") oldIds.add(node.attrs.id);
        });
        const newIds = new Set<string>();
        newState.doc.forEach((node) => {
          if (node.type.name === "entry") newIds.add(node.attrs.id);
        });
        const removed = new Set<string>();
        for (const id of oldIds) {
          if (!newIds.has(id)) removed.add(id);
        }
        if (removed.size > 0) {
          let fixTr = this.state.tr;
          let needsFix = false;
          fixTr.doc.descendants((node, pos) => {
            if (
              (node.type.name === "dialogue" || node.type.name === "choice") &&
              node.attrs.next && removed.has(node.attrs.next)
            ) {
              fixTr = fixTr.setNodeMarkup(pos, null, { ...node.attrs, next: null });
              needsFix = true;
            }
          });
          if (needsFix) this.dispatch(fixTr);
        }
      }

      scheduleRefresh(this);
    },
  });

  wrapper.appendChild(overlay);

  // draw arrows after initial render
  requestAnimationFrame(() => refresh(view));
  setupArrowInteraction(view);
  setupDragDrop(view);

  // Remote editing indicators on char-name headers
  function updateEditingIndicators() {
    const obs = (view as any).domObserver;
    obs?.stop?.();
    // clear old indicators
    view.dom.querySelectorAll(".editing-indicator").forEach((el) => el.remove());
    view.dom.querySelectorAll(".char-name-editing").forEach((el) => {
      el.classList.remove("char-name-editing");
      (el as HTMLElement).style.removeProperty("--editor-color");
    });

    const localClientId = collab.ydoc.clientID;
    collab.provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === localClientId) return;
      const editingId = state.editing;
      if (!editingId) return;
      const user = state.user;
      if (!user) return;

      const entryEl = view.dom.querySelector(`.entry[data-entry-id="${editingId}"]`);
      if (!entryEl) return;
      const charName = entryEl.querySelector(".char-name") as HTMLElement;
      if (!charName) return;

      charName.classList.add("char-name-editing");
      charName.style.setProperty("--editor-color", user.color);

      const tag = document.createElement("span");
      tag.className = "editing-indicator";
      tag.textContent = user.name;
      tag.style.backgroundColor = user.color;
      charName.appendChild(tag);
    });
    obs?.start?.();
  }

  collab.provider.awareness.on("change", updateEditingIndicators);

  // checkbox toggles via ProseMirror transactions
  view.dom.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("choice-checkbox")) return;

    const choiceEl = target.closest(".choice") as HTMLElement;
    if (!choiceEl) return;

    const pos = view.posAtDOM(choiceEl, 0);
    const $pos = view.state.doc.resolve(pos);

    // find choice node depth
    let depth = $pos.depth;
    while (depth > 0 && $pos.node(depth).type.name !== "choice") depth--;
    if (depth === 0) return;

    const choiceNode = $pos.node(depth);
    const choicePos = $pos.before(depth);
    const newChecked = !choiceNode.attrs.checked;

    // check if toggling would make all checked → reset all
    const decisionNode = $pos.node(depth - 1);
    let allWouldBeChecked = true;
    decisionNode.forEach((child) => {
      if (child.type.name === "choice") {
        const wouldBe = child === choiceNode ? newChecked : child.attrs.checked;
        if (!wouldBe) allWouldBeChecked = false;
      }
    });

    let tr = view.state.tr;
    if (allWouldBeChecked) {
      // uncheck all choices in this decision
      const decisionPos = $pos.before(depth - 1);
      let offset = 1; // skip into decision content
      decisionNode.forEach((child) => {
        if (child.type.name === "choice" && child.attrs.checked) {
          tr = tr.setNodeMarkup(decisionPos + offset, null, {
            ...child.attrs,
            checked: false,
          });
        }
        offset += child.nodeSize;
      });
    } else {
      tr = tr.setNodeMarkup(choicePos, null, {
        ...choiceNode.attrs,
        checked: newChecked,
      });
    }

    view.dispatch(tr);
  });
});
