import "./style.css";
import "prosemirror-view/style/prosemirror.css";
import { Schema, Node as PMNode, type DOMOutputSpec } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { lines } from "./schema.ts";
import {
  EditorView as CMEditorView,
  keymap as cmKeymap,
} from "@codemirror/view";
import { EditorState as CMEditorState } from "@codemirror/state";
import { json as jsonLang } from "@codemirror/lang-json";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { undo, redo } from "y-prosemirror";
import { createCollab, type Collab } from "./collab.ts";
import { Notyf } from "notyf";
import "notyf/notyf.min.css";
import { route, navigate, resolve, onCleanup } from "./router.ts";
import { mountDocList } from "./doc-list.ts";


export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export let currentUser: AuthUser | null = null;

const notyf = new Notyf({
  duration: 6000,
  position: { x: "right", y: "bottom" },
  ripple: false,
});

export const scriptSchema = new Schema({
  nodes: {
    doc: {
      content: "entry+",
    },
    entry: {
      attrs: { id: { default: "" } },
      content: "dialogue | decision",
      toDOM(node): DOMOutputSpec {
        return [
          "section",
          { class: "entry", "data-entry-id": node.attrs.id },
          0,
        ];
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
        const charNameChildren: DOMOutputSpec[] = [
          ["span", { class: "char-name-link" }, node.attrs.char],
        ];
        if (node.attrs.trigger)
          charNameChildren.push([
            "span",
            { class: "trigger-badge", contenteditable: "false" },
            node.attrs.trigger,
          ]);
        return [
          "div",
          attrs,
          [
            "div",
            { class: "char-name", contenteditable: "false", draggable: "true" },
            ...charNameChildren,
          ],
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
          [
            "div",
            { class: "char-name", contenteditable: "false", draggable: "true" },
            ["span", { class: "char-name-link" }, "PLAYER"],
          ],
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
        if (node.attrs.cond)
          indicators.push([
            "span",
            {
              class: "choice-badge choice-badge-cond",
              contenteditable: "false",
            },
            "?",
          ]);
        if (node.attrs.effect)
          indicators.push([
            "span",
            {
              class: "choice-badge choice-badge-effect",
              contenteditable: "false",
            },
            "!",
          ]);
        return [
          "div",
          attrs,
          [
            "span",
            { class: "choice-checkbox", contenteditable: "false" },
            node.attrs.checked ? "\u2611" : "\u2610",
          ],
          [
            "span",
            {
              class: "drag-handle",
              contenteditable: "false",
              draggable: "true",
            },
            "\u2847",
          ],
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
        const {
          text: ct,
          next: cn,
          effect: ce,
          cond: cc,
          ...choiceExtra
        } = choice;
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
      const {
        char,
        text: rawText,
        delay,
        next,
        trigger,
        unskippable,
        randomize,
        ...dialogueExtra
      } = node as any;
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

let entryIdCounter = 0;
function generateEntryId(): string {
  return `new_${++entryIdCounter}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function selectBlock(state: EditorState, dispatch?: (tr: any) => void) {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  if (depth === 0) return false;
  if (dispatch) {
    const start = $from.start(depth);
    const end = $from.end(depth);
    dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, start, end)),
    );
  }
  return true;
}

// --- mountEditor ---

export function mountEditor(
  appEl: HTMLElement,
  docId: string,
  canEdit = true,
  isOwner = false,
): () => void {
  appEl.innerHTML = "";

  const collab = createCollab(
    docId,
    currentUser
      ? { name: currentUser.displayName, username: currentUser.username }
      : undefined,
  );

  // overlay container for SVGs — sits outside ProseMirror's managed DOM
  let overlay: HTMLElement;
  let customDragActive = false;

  let charNameMousedown: { x: number; y: number; target: HTMLElement } | null =
    null;
  let activeJsonEditor: {
    popup: HTMLElement;
    cmView: CMEditorView;
    save: () => void;
    cleanup: () => void;
    entryId: string;
  } | null = null;

  // maps SVG group elements to the source DOM element that owns the `next` attr
  let arrowSourceMap = new Map<Element, HTMLElement>();
  let exitArrowSourceMap = new Map<Element, HTMLElement>();
  let selectedArrowGroup: SVGGElement | null = null;

  function selectArrow(group: SVGGElement | null) {
    if (selectedArrowGroup) {
      const vis = selectedArrowGroup.querySelector(".arrow-visible");
      if (vis) {
        const origStroke =
          (vis as SVGElement).dataset.origStroke ??
          (vis.getAttribute("marker-end")?.includes("seq") ? "#555" : "#666");
        vis.setAttribute("stroke", origStroke);
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
    const margin = parseFloat(getComputedStyle(root).paddingLeft) || 0;
    const r = 6;

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

      const markerSel = marker.cloneNode(true) as SVGMarkerElement;
      markerSel.setAttribute("id", `arrowhead-${side}-selected`);
      markerSel.querySelector("path")!.setAttribute("fill", "#e8e857");
      defs.appendChild(markerSel);

      const markerChoice = marker.cloneNode(true) as SVGMarkerElement;
      markerChoice.setAttribute("id", `arrowhead-${side}-choice`);
      markerChoice.querySelector("path")!.setAttribute("fill", "#4a8a9e");
      defs.appendChild(markerChoice);

      const markerChoiceSel = marker.cloneNode(true) as SVGMarkerElement;
      markerChoiceSel.setAttribute("id", `arrowhead-${side}-choice-selected`);
      markerChoiceSel.querySelector("path")!.setAttribute("fill", "#e8e857");
      defs.appendChild(markerChoiceSel);

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

    type ArrowInfo = {
      choiceY: number;
      targetY: number;
      span: number;
      startX?: number;
      sourceEl: HTMLElement;
    };
    const downArrows: ArrowInfo[] = [];
    const upArrows: ArrowInfo[] = [];

    const rootTop = root.getBoundingClientRect().top;

    const choices = root.querySelectorAll<HTMLElement>(".choice[data-next]");
    choices.forEach((choiceEl) => {
      if (
        choiceEl.closest(".entry-hidden") ||
        choiceEl.classList.contains("choice-dimmed")
      )
        return;
      const nextId = choiceEl.dataset.next!;
      const targetEl = root.querySelector<HTMLElement>(
        `.entry[data-entry-id="${nextId}"]`,
      );
      if (!targetEl || targetEl.classList.contains("entry-hidden")) return;

      const choiceY =
        choiceEl.getBoundingClientRect().top -
        rootTop +
        choiceEl.offsetHeight / 2;
      const targetY = targetEl.getBoundingClientRect().top - rootTop + 8;

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

    type SeqArrow = {
      fromY: number;
      toY: number;
      x: number;
      sourceEl: HTMLElement;
    };
    const seqArrows: SeqArrow[] = [];

    const dialogues = root.querySelectorAll<HTMLElement>(
      ".dialogue[data-next]",
    );
    dialogues.forEach((dialogueEl) => {
      const entry = dialogueEl.closest(".entry") as HTMLElement;
      if (!entry || entry.classList.contains("entry-hidden")) return;
      const nextId = dialogueEl.dataset.next!;

      let nextEntry = entry.nextElementSibling;
      while (
        nextEntry &&
        (!nextEntry.matches(".entry") ||
          (nextEntry as HTMLElement).classList.contains("entry-hidden"))
      )
        nextEntry = nextEntry.nextElementSibling;

      if (nextEntry && (nextEntry as HTMLElement).dataset.entryId === nextId) {
        const entryRect = entry.getBoundingClientRect();
        const nextRect = nextEntry.getBoundingClientRect();
        const fromY = entryRect.bottom - root.getBoundingClientRect().top;
        const toY = nextRect.top - root.getBoundingClientRect().top;
        const x = margin + (root.clientWidth - margin * 2) / 2;
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
        sourceEl.getBoundingClientRect().top -
        rootTop +
        sourceEl.offsetHeight / 2;
      const targetY = targetEl.getBoundingClientRect().top - rootTop + 8;

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
      const n = arrows.length;
      if (n === 0) return [];

      const intervals = arrows.map((a, i) => ({
        idx: i,
        top: Math.min(a.choiceY, a.targetY),
        bottom: Math.max(a.choiceY, a.targetY),
        span: a.span,
      }));

      intervals.sort((a, b) => a.top - b.top || b.span - a.span);

      const columnBottoms: number[] = [];
      const localCols = new Array(n).fill(0);

      for (const iv of intervals) {
        let col = -1;
        for (let c = 0; c < columnBottoms.length; c++) {
          if (columnBottoms[c] <= iv.top) {
            col = c;
            break;
          }
        }
        if (col === -1) {
          col = columnBottoms.length;
          columnBottoms.push(0);
        }
        columnBottoms[col] = iv.bottom;
        localCols[iv.idx] = col;
      }

      const maxCol = Math.max(...localCols, 0);
      return localCols.map((c) => maxCol - c);
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
      const isChoice = sourceEl.classList.contains("choice");
      const strokeColor = isChoice ? "#4a8a9e" : "#666";
      visPath.setAttribute("stroke", strokeColor);
      visPath.dataset.origStroke = strokeColor;
      visPath.setAttribute("stroke-width", "1.5");
      visPath.setAttribute(
        "marker-end",
        `url(#arrowhead-${side}${isChoice ? "-choice" : ""})`,
      );
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
      const xInner = margin - 12;
      const xOuter = 8;
      const maxCol = Math.max(...cols, 0);
      const xStep = maxCol > 0 ? Math.min(12, (xInner - xOuter) / maxCol) : 0;

      arrows.forEach((a, i) => {
        const col = cols[i];
        const x = xInner - col * xStep;
        const { choiceY, targetY } = a;
        let d: string;

        if (side === "left") {
          d = [
            `M ${margin - 4} ${choiceY}`,
            `H ${x + r}`,
            `A ${r} ${r} 0 0 0 ${x} ${choiceY + r}`,
            `V ${targetY - r}`,
            `A ${r} ${r} 0 0 0 ${x + r} ${targetY}`,
            `H ${margin - 4}`,
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
        if (
          el.closest(".entry-hidden") ||
          el.closest(".entry")?.classList.contains("entry-hidden")
        )
          return;
        if (el.classList.contains("choice-dimmed")) return;
        let measureEl: HTMLElement = el;
        if (el.classList.contains("dialogue")) {
          measureEl = el.querySelector(".char-name") ?? el;
        }
        const y =
          measureEl.getBoundingClientRect().top -
          rootTop +
          measureEl.offsetHeight / 2;

        const walker = document.createTreeWalker(
          measureEl,
          NodeFilter.SHOW_TEXT,
        );
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

  // Track global listeners for cleanup
  const globalListeners: {
    target: EventTarget;
    type: string;
    handler: EventListener;
    capture?: boolean;
  }[] = [];

  function addGlobalListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    capture?: boolean,
  ) {
    target.addEventListener(type, handler, capture);
    globalListeners.push({ target, type, handler, capture });
  }

  function setupArrowInteraction(view: EditorView) {
    const root = view.dom;

    overlay.addEventListener("click", (e) => {
      const g = (e.target as Element).closest("g");
      if (g && arrowSourceMap.has(g)) {
        e.stopPropagation();
        selectArrow(g as SVGGElement);
        return;
      }
      selectArrow(null);
    });

    function onKeydown(e: Event) {
      const ke = e as KeyboardEvent;
      if (!selectedArrowGroup) return;
      if (ke.key !== "Delete" && ke.key !== "Backspace") return;

      const sourceEl = arrowSourceMap.get(selectedArrowGroup);
      if (!sourceEl) return;

      ke.preventDefault();
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
    }
    addGlobalListener(document, "keydown", onKeydown);

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

      const rootRect = root.getBoundingClientRect();
      let measureEl: HTMLElement = dragSourceEl;
      if (dragSourceEl.classList.contains("dialogue")) {
        measureEl = dragSourceEl.querySelector(".char-name") ?? dragSourceEl;
      }
      const measRect = measureEl.getBoundingClientRect();
      const startY = measRect.top - rootRect.top + measRect.height / 2;

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
      const startX = textEndX + 36;

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

    function onDragEnd(_e: MouseEvent) {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);

      const obs = (view as any).domObserver;
      if (hoveredEntry) {
        obs?.stop?.();
        hoveredEntry.classList.remove("connect-target");
        obs?.start?.();
        const targetId = hoveredEntry.dataset.entryId;

        if (targetId && dragSourceEl) {
          const sourceEntry = dragSourceEl.closest(
            ".entry",
          ) as HTMLElement | null;
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

      const handle = target.closest(".drag-handle");
      if (handle) {
        dragSource = handle.closest(".choice") as HTMLElement;
        dragType = "choice";
      } else {
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

    let indicatorEl: HTMLElement | null = null;
    let insertAfterIndicator = false;

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
        while (n && (!n.matches(selector) || isHidden(n)))
          n = n.nextElementSibling;
        return n;
      };
      const prevVisible = (el: Element): Element | null => {
        let n = el.previousElementSibling;
        while (n && (!n.matches(selector) || isHidden(n)))
          n = n.previousElementSibling;
        return n;
      };

      let el = (e.target as HTMLElement).closest(selector) as HTMLElement;

      if (el && isHidden(el)) el = null as any;

      if (
        el &&
        dragType === "choice" &&
        el.parentElement !== dragSource!.parentElement
      ) {
        clearIndicators();
        return;
      }

      if (!el) {
        const container =
          dragType === "choice" ? dragSource!.parentElement! : dom;
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
      dom
        .querySelectorAll(".drag-over-top, .drag-over-bottom")
        .forEach((ind) =>
          ind.classList.remove("drag-over-top", "drag-over-bottom"),
        );

      const rect = el.getBoundingClientRect();
      const inBottomHalf = e.clientY > rect.top + rect.height / 2;

      if (el === dragSource ? inBottomHalf : inBottomHalf) {
        let next = el.nextElementSibling;
        while (next && skipSibling(next)) next = next.nextElementSibling;
        if (next) {
          indicatorEl = next as HTMLElement;
          insertAfterIndicator = false;
          indicatorEl.classList.add("drag-over-top");
        } else if (el !== dragSource) {
          indicatorEl = el;
          insertAfterIndicator = true;
          indicatorEl.classList.add("drag-over-bottom");
        }
      } else if (el === dragSource) {
        let prev = el.previousElementSibling;
        while (prev && skipSibling(prev)) prev = prev.previousElementSibling;
        if (prev) {
          indicatorEl = prev as HTMLElement;
          insertAfterIndicator = true;
          indicatorEl.classList.add("drag-over-bottom");
        } else {
          let next = el.nextElementSibling;
          while (next && skipSibling(next)) next = next.nextElementSibling;
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

      if (indicatorEl) {
        const isNoOp = insertAfterIndicator
          ? nextVisible(indicatorEl) === dragSource
          : prevVisible(indicatorEl) === dragSource ||
            indicatorEl === nextVisible(dragSource!);
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

      const nodeType = dragType === "choice" ? "decision" : "doc";
      let parentDepth = $source.depth;
      while (
        parentDepth > 0 &&
        $source.node(parentDepth).type.name !== nodeType
      ) {
        parentDepth--;
      }
      if (dragType === "choice" && parentDepth === 0) {
        cleanup();
        return;
      }

      if (
        parentDepth > 0 &&
        $source.before(parentDepth) !== $target.before(parentDepth)
      ) {
        cleanup();
        return;
      }

      const sourceIndex = $source.index(parentDepth);
      let targetIndex = $target.index(parentDepth);
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

    function onDocDragover(e: Event) {
      const de = e as DragEvent;
      if (!dragSource || dragType !== "entry") return;
      const editorTop = dom.getBoundingClientRect().top;
      if (de.clientY >= editorTop) return;

      de.preventDefault();
      de.dataTransfer!.dropEffect = "move";

      const obs = (view as any).domObserver;
      obs?.stop?.();
      dom
        .querySelectorAll(".drag-over-top, .drag-over-bottom")
        .forEach((ind) =>
          ind.classList.remove("drag-over-top", "drag-over-bottom"),
        );

      const first = dom.querySelector<HTMLElement>(
        ".entry:not(.entry-hidden):not(.dragging)",
      );
      if (first && first !== dragSource) {
        indicatorEl = first;
        insertAfterIndicator = false;
        first.classList.add("drag-over-top");
      }
      obs?.start?.();
    }
    addGlobalListener(document, "dragover", onDocDragover as EventListener);

    function onDocDrop(e: Event) {
      const de = e as DragEvent;
      if (!dragSource || dragType !== "entry" || !indicatorEl) return;
      const editorTop = dom.getBoundingClientRect().top;
      if (de.clientY >= editorTop) return;
      de.preventDefault();
      dom.dispatchEvent(new DragEvent("drop", { bubbles: true }));
    }
    addGlobalListener(document, "drop", onDocDrop as EventListener);

    const obs = (view as any).domObserver;

    function clearIndicators() {
      obs?.stop?.();
      dom
        .querySelectorAll(".drag-over-top, .drag-over-bottom")
        .forEach((el) =>
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
    root
      .querySelectorAll<HTMLElement>(".entry[data-entry-id]")
      .forEach((entry) => {
        const id = entry.dataset.entryId!;
        if (!allNextTargets.has(id)) ids.push(id);
      });
    return ids;
  }

  function walkGraph(
    root: HTMLElement,
    startIds: string[],
    respectChecks = true,
  ): Set<string> {
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

    entries.forEach((e) =>
      e.classList.remove("entry-hidden", "entry-detached"),
    );
    root
      .querySelectorAll(".choice")
      .forEach((e) => e.classList.remove("choice-dimmed"));

    if (hasAnyChecks) {
      root.querySelectorAll(".decision").forEach((decision) => {
        const checked = decision.querySelectorAll(".choice[data-checked]");
        if (checked.length > 0) {
          decision.querySelectorAll(".choice").forEach((choice) => {
            if (!choice.hasAttribute("data-checked"))
              choice.classList.add("choice-dimmed");
          });
        }
      });
    }

    const rootIds = filterEntrypoint
      ? [filterEntrypoint]
      : getEntrypoints(root);

    if (!hasAnyChecks && !filterEntrypoint) return;

    const reachable = walkGraph(root, rootIds);

    const fullSubgraph =
      filterEntrypoint && hasAnyChecks
        ? walkGraph(root, rootIds, false)
        : reachable;

    if (filterEntrypoint) {
      for (const id of fullSubgraph) pinnedEntries.add(id);
    }

    entries.forEach((entry) => {
      const id = entry.dataset.entryId!;
      if (reachable.has(id)) return;

      if (fullSubgraph.has(id) || !pinnedEntries.has(id)) {
        entry.classList.add("entry-hidden");
      } else {
        entry.classList.add("entry-detached");
      }
    });
  }

  function labelEntrypoints(root: HTMLElement) {
    root.querySelectorAll(".entrypoint-label").forEach((el) => el.remove());

    const allNextTargets = new Set<string>();
    root.querySelectorAll<HTMLElement>("[data-next]").forEach((el) => {
      allNextTargets.add(el.dataset.next!);
    });

    root
      .querySelectorAll<HTMLElement>(".entry[data-entry-id]")
      .forEach((entry) => {
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
    while (filterSelect.options.length > 1) filterSelect.remove(1);
    for (const id of entrypoints) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      filterSelect.appendChild(opt);
    }
    if (current && entrypoints.includes(current)) {
      filterSelect.value = current;
    } else if (current) {
      filterSelect.value = "";
      filterEntrypoint = null;
    }
  }

  function refresh(view: EditorView) {
    const obs = (view as any).domObserver;
    obs?.stop?.();
    updateFilterDropdown(view.dom);
    updateVisibility(view.dom);
    labelEntrypoints(view.dom);
    obs?.start?.();
    drawArrows(view);
  }

  let activeNameInput: HTMLInputElement | null = null;

  function findEntryPosByID(
    doc: PMNode,
    id: string,
  ): { pos: number; node: PMNode } | null {
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

  function finalizeDialogue(
    view: EditorView,
    id: string,
    charName: string,
    sourceEntryId?: string,
  ) {
    const found = findEntryPosByID(view.state.doc, id);
    if (!found) return;
    const dialoguePos = found.pos + 1;
    const dialogueNode = found.node.firstChild!;
    const newDialogue = scriptSchema.nodes.dialogue.create(
      { ...dialogueNode.attrs, char: charName },
      dialogueNode.content,
    );
    let tr = view.state.tr.replaceWith(
      dialoguePos,
      dialoguePos + dialogueNode.nodeSize,
      newDialogue,
    );

    if (sourceEntryId) {
      const sourceFound = findEntryPosByID(tr.doc, sourceEntryId);
      if (sourceFound) {
        const sourceInner = sourceFound.node.firstChild!;
        if (sourceInner.type.name === "dialogue") {
          const sourceDialoguePos = sourceFound.pos + 1;
          tr = tr.setNodeMarkup(sourceDialoguePos, null, {
            ...sourceInner.attrs,
            next: id,
          });
        }
      }
    }

    view.dispatch(tr);
    requestAnimationFrame(() => {
      const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
      const lineEl = entryEl?.querySelector(".line");
      if (lineEl) {
        const pos = view.posAtDOM(lineEl, 0);
        const tr2 = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pos),
        );
        view.dispatch(tr2);
        view.focus();
      }
    });
  }

  function convertToDecision(
    view: EditorView,
    id: string,
    sourceEntryId?: string,
  ) {
    const found = findEntryPosByID(view.state.doc, id);
    if (!found) return;
    const dialoguePos = found.pos + 1;
    const dialogueNode = found.node.firstChild!;
    const decision = scriptSchema.nodes.decision.create(null, [
      scriptSchema.nodes.choice.create(null),
    ]);
    let tr = view.state.tr.replaceWith(
      dialoguePos,
      dialoguePos + dialogueNode.nodeSize,
      decision,
    );

    if (sourceEntryId) {
      const sourceFound = findEntryPosByID(tr.doc, sourceEntryId);
      if (sourceFound) {
        const sourceInner = sourceFound.node.firstChild!;
        if (sourceInner.type.name === "dialogue") {
          const sourceDialoguePos = sourceFound.pos + 1;
          tr = tr.setNodeMarkup(sourceDialoguePos, null, {
            ...sourceInner.attrs,
            next: id,
          });
        }
      }
    }

    view.dispatch(tr);
    requestAnimationFrame(() => {
      const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
      const choiceText = entryEl?.querySelector(".choice-text");
      if (choiceText) {
        const pos = view.posAtDOM(choiceText, 0);
        const tr2 = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pos),
        );
        view.dispatch(tr2);
        view.focus();
      }
    });
  }

  function getExistingCharNames(view: EditorView): string[] {
    const names = new Set<string>();
    view.state.doc.forEach((node) => {
      if (node.type.name === "entry") {
        const inner = node.firstChild;
        if (inner?.type.name === "dialogue" && inner.attrs.char) {
          names.add(inner.attrs.char.toUpperCase());
        }
      }
    });
    names.add("PLAYER");
    return Array.from(names).sort();
  }

  function showNameInput(view: EditorView, id: string, sourceEntryId?: string) {
    const entryEl = view.dom.querySelector(`.entry[data-entry-id="${id}"]`);
    if (!entryEl) return;
    const charNameEl = entryEl.querySelector(".char-name") as HTMLElement;
    if (!charNameEl) return;

    const input = document.createElement("input");
    input.className = "char-name-input";
    input.placeholder = "@autocomplete or type name";
    input.type = "text";
    input.value = "@";

    const dropdown = document.createElement("div");
    dropdown.className = "name-autocomplete";
    const allNames = getExistingCharNames(view);
    let filtered: string[] = allNames;
    let selectedIdx = 0;

    function isAutocompleteMode() {
      return input.value.startsWith("@");
    }

    function updateDropdown() {
      if (!isAutocompleteMode()) {
        filtered = [];
        selectedIdx = -1;
        renderDropdown();
        return;
      }
      const query = input.value.slice(1).trim().toUpperCase();
      filtered = query ? allNames.filter((n) => n.startsWith(query)) : allNames;
      selectedIdx = filtered.length > 0 ? 0 : -1;
      renderDropdown();
    }

    function renderDropdown() {
      dropdown.innerHTML = "";
      if (filtered.length === 0) {
        dropdown.style.display = "none";
        return;
      }
      dropdown.style.display = "block";
      filtered.forEach((name, i) => {
        const item = document.createElement("div");
        item.className =
          "name-autocomplete-item" + (i === selectedIdx ? " selected" : "");
        item.textContent = name;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = name;
          dropdown.style.display = "none";
          commit();
        });
        dropdown.appendChild(item);
      });
    }

    function positionInput() {
      const wrapperRect = overlay.parentElement!.getBoundingClientRect();
      const charRect = charNameEl.getBoundingClientRect();
      input.style.position = "absolute";
      input.style.left = charRect.left - wrapperRect.left + "px";
      input.style.top = charRect.top - wrapperRect.top + "px";
      input.style.width = charRect.width + "px";
      input.style.height = charRect.height + "px";
      dropdown.style.position = "absolute";
      dropdown.style.left = charRect.left - wrapperRect.left + "px";
      dropdown.style.top = charRect.bottom - wrapperRect.top + 2 + "px";
      dropdown.style.width = charRect.width + "px";
    }
    positionInput();

    overlay.appendChild(input);
    overlay.appendChild(dropdown);
    activeNameInput = input;
    input.focus();
    input.setSelectionRange(1, 1);
    renderDropdown();

    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      let value: string;
      if (isAutocompleteMode()) {
        value =
          selectedIdx >= 0 && filtered[selectedIdx]
            ? filtered[selectedIdx]
            : input.value.slice(1).trim().toUpperCase();
      } else {
        value = input.value.trim().toUpperCase();
      }
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
      dropdown.remove();
      activeNameInput = null;
    }

    input.addEventListener("input", updateDropdown);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && isAutocompleteMode() && filtered.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          selectedIdx =
            selectedIdx <= 0 ? filtered.length - 1 : selectedIdx - 1;
        } else {
          selectedIdx = (selectedIdx + 1) % filtered.length;
        }
        renderDropdown();
      } else if (e.key === "Enter") {
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

  function createEntryBelow(
    state: EditorState,
    dispatch?: (tr: any) => void,
    view?: EditorView,
  ) {
    if (activeNameInput) return false;

    const { $from } = state.selection;
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

      const entryNode = $from.node(depth);
      const inner = entryNode.firstChild;
      if (inner && inner.type.name === "decision") {
        let choiceDepth = $from.depth;
        while (
          choiceDepth > 0 &&
          $from.node(choiceDepth).type.name !== "choice"
        )
          choiceDepth--;
        const cursorChoice = choiceDepth > 0 ? $from.node(choiceDepth) : null;

        let linked = false;
        if (
          cursorChoice &&
          !cursorChoice.attrs.checked &&
          !cursorChoice.attrs.next
        ) {
          const choicePos = $from.before(choiceDepth);
          tr = tr.setNodeMarkup(choicePos, null, {
            ...cursorChoice.attrs,
            next: newId,
          });
          linked = true;
        }

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
            tr = tr.setNodeMarkup(choicePos, null, {
              ...checkedChoices[0].node.attrs,
              next: newId,
            });
          }
        }
      }

      const sourceEntryNode = $from.node(depth);
      const sourceInner = sourceEntryNode.firstChild;
      const sourceId =
        sourceInner?.type.name === "dialogue"
          ? sourceEntryNode.attrs.id
          : undefined;

      dispatch(tr);
      requestAnimationFrame(() => showNameInput(view, newId, sourceId));
    }
    return true;
  }

  function buildNodeJson(
    view: EditorView,
    charNameEl: HTMLElement,
  ): {
    json: Record<string, any>;
    entryPos: number;
    nodePos: number;
    nodeType: "dialogue" | "decision";
    entryNode: PMNode;
    innerNode: PMNode;
  } | null {
    const pos = view.posAtDOM(charNameEl, 0);
    const $pos = view.state.doc.resolve(pos);

    let depth = $pos.depth;
    while (depth > 0 && $pos.node(depth).type.name !== "entry") depth--;
    if (depth === 0) return null;

    const entryNode = $pos.node(depth);
    const entryPos = $pos.before(depth);
    const innerNode = entryNode.firstChild!;
    const nodePos = entryPos + 1;

    if (innerNode.type.name === "dialogue") {
      const a = innerNode.attrs;
      const json: Record<string, any> = {
        id: entryNode.attrs.id,
        char: a.char,
      };
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
      return {
        json,
        entryPos,
        nodePos,
        nodeType: "dialogue",
        entryNode,
        innerNode,
      };
    } else if (innerNode.type.name === "decision") {
      const json: Record<string, any> = { id: entryNode.attrs.id };
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
      return {
        json,
        entryPos,
        nodePos,
        nodeType: "decision",
        entryNode,
        innerNode,
      };
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
    activeJsonEditor.save();
    dismissJsonEditor(view);
  }

  function openJsonEditor(view: EditorView, charNameEl: HTMLElement) {
    const entryEl = charNameEl.closest(".entry") as HTMLElement | null;
    const clickedEntryId = entryEl?.dataset.entryId ?? null;
    if (activeJsonEditor) {
      const same =
        clickedEntryId !== null && activeJsonEditor.entryId === clickedEntryId;
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

    const wrapperRect = overlay.parentElement!.getBoundingClientRect();
    const charRect = charNameEl.getBoundingClientRect();
    popup.style.position = "absolute";
    popup.style.left = charRect.left - wrapperRect.left + "px";
    popup.style.top = charRect.bottom - wrapperRect.top + 4 + "px";
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

      const oldId = data.entryNode.attrs.id;
      if (id !== undefined && id !== oldId) {
        let duplicate = false;
        view.state.doc.forEach((node) => {
          if (node.type.name === "entry" && node.attrs.id === id)
            duplicate = true;
        });
        if (duplicate) {
          notyf.error(`ID "${id}" already exists`);
          return;
        }

        tr = tr.setNodeMarkup(data.entryPos, null, {
          ...data.entryNode.attrs,
          id,
        });
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
        const {
          char,
          delay,
          next,
          trigger,
          unskippable,
          randomize,
          text,
          ...extra
        } = rest;
        const newAttrs = {
          char: char ?? data.innerNode.attrs.char,
          delay: delay ?? null,
          next: next ?? null,
          trigger: trigger ?? null,
          unskippable: unskippable ?? false,
          randomize: randomize ?? false,
          extra: Object.keys(extra).length > 0 ? extra : null,
        };
        let content = data.innerNode.content;
        if (text !== undefined) {
          const textArray = Array.isArray(text) ? text : [text];
          const lineNodes = textArray.map((l: any) => {
            if (typeof l === "string") {
              return scriptSchema.nodes.line.create(
                null,
                l ? scriptSchema.text(l) : undefined,
              );
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
          content = scriptSchema.nodes.dialogue.createChecked(
            newAttrs,
            lineNodes,
          ).content;
        }
        const newDialogue = scriptSchema.nodes.dialogue.create(
          newAttrs,
          content,
        );
        const mappedNodePos = tr.mapping.map(data.nodePos);
        const mappedNodeEnd = tr.mapping.map(
          data.nodePos + data.innerNode.nodeSize,
        );
        tr = tr.replaceWith(mappedNodePos, mappedNodeEnd, newDialogue);
      } else if (data.nodeType === "decision") {
        const { input, ...extra } = rest;
        const extraAttr = Object.keys(extra).length > 0 ? extra : null;
        let content = data.innerNode.content;
        if (input !== undefined && Array.isArray(input)) {
          const choiceNodes = input.map((c: any) => {
            const {
              text: ct,
              next: cn,
              effect: ce,
              cond: cc,
              checked: ck,
              ...choiceExtra
            } = c;
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
          content = scriptSchema.nodes.decision.createChecked(
            { extra: extraAttr },
            choiceNodes,
          ).content;
        }
        const newDecision = scriptSchema.nodes.decision.create(
          { extra: extraAttr },
          content,
        );
        const mappedNodePos = tr.mapping.map(data.nodePos);
        const mappedNodeEnd = tr.mapping.map(
          data.nodePos + data.innerNode.nodeSize,
        );
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
              run: () => {
                dismissJsonEditor(view);
                return true;
              },
            },
          ]),
          CMEditorView.theme({
            "&": { fontSize: "13px" },
          }),
        ],
      }),
    });

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!popup.contains(target) && !target.closest(".char-name-link")) {
        closeJsonEditor(view);
      }
    }
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
    collab.provider.awareness.setLocalStateField(
      "editing",
      data.entryNode.attrs.id,
    );
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

  // Subgraph filter state
  let filterEntrypoint: string | null = null;
  const pinnedEntries = new Set<string>();
  const filterSelect = document.createElement("select");
  filterSelect.className = "subgraph-filter";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All entrypoints";
  filterSelect.appendChild(allOption);

  // We need a forward reference for `view` since it's created in the sync callback
  let view: EditorView;

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

  // Build toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const backLink = document.createElement("a");
  backLink.className = "toolbar-back";
  backLink.href = "/";
  backLink.textContent = "All Documents";
  backLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/");
  });
  toolbar.appendChild(backLink);

  const docName = document.createElement("span");
  docName.className = "toolbar-doc-name";
  docName.textContent = docId;
  toolbar.appendChild(docName);

  toolbar.appendChild(filterSelect);

  const exportBtn = document.createElement("button");
  exportBtn.className = "export-btn";
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", () => {
    if (!view) return;
    const json = docToJson(view.state.doc);
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  toolbar.appendChild(exportBtn);

  if (isOwner) {
    const importBtn = document.createElement("button");
    importBtn.className = "export-btn";
    importBtn.textContent = "Import";
    importBtn.addEventListener("click", () => {
      if (!view) return;
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json,application/json";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            const pmDoc = linesToDoc(data);
            const tr = view.state.tr;
            tr.replaceWith(0, view.state.doc.content.size, pmDoc.content);
            view.dispatch(tr);
            notyf.success("JSON imported");
          } catch (err: any) {
            notyf.error("Import failed: " + err.message);
          }
        };
        reader.readAsText(file);
      });
      fileInput.click();
    });
    toolbar.appendChild(importBtn);
  }

  // Auth UI in toolbar
  if (currentUser) {
    if (currentUser.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.src = currentUser.avatarUrl;
      avatar.className = "toolbar-avatar";
      avatar.alt = currentUser.displayName;
      toolbar.appendChild(avatar);
    }
    const userSpan = document.createElement("span");
    userSpan.className = "toolbar-user";
    userSpan.textContent = currentUser.displayName;
    toolbar.appendChild(userSpan);

    const logoutLink = document.createElement("a");
    logoutLink.href = "/auth/logout";
    logoutLink.className = "toolbar-logout";
    logoutLink.textContent = "Logout";
    toolbar.appendChild(logoutLink);
  } else {
    const loginLink = document.createElement("a");
    loginLink.href = "/auth/twitch";
    loginLink.className = "toolbar-login";
    loginLink.textContent = "Sign in with Twitch";
    toolbar.appendChild(loginLink);
  }

  appEl.appendChild(toolbar);

  // DOM setup
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  appEl.appendChild(wrapper);

  overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";

  // Track whether we've been destroyed to prevent late sync callbacks
  let destroyed = false;

  // Wait for initial Yjs sync before creating the editor
  collab.provider.on("sync", (synced: boolean) => {
    if (!synced || view || destroyed) return;

    // Seed the Y.Doc on first load with a single empty entry
    if (collab.yXmlFragment.length === 0) {
      const emptyDoc = scriptSchema.nodes.doc.create(null, [
        scriptSchema.nodes.entry.create(
          { id: generateEntryId() },
          scriptSchema.nodes.decision.create(null, [
            scriptSchema.nodes.choice.create(null),
          ]),
        ),
      ]);
      const tempYDoc = prosemirrorJSONToYDoc(scriptSchema, emptyDoc.toJSON());
      const update = Y.encodeStateAsUpdate(tempYDoc);
      Y.applyUpdate(collab.ydoc, update);
      tempYDoc.destroy();
    }

    const editKeymap = canEdit
      ? [
          keymap({
            "Mod-z": undo,
            "Mod-y": redo,
            "Mod-Shift-z": redo,
            "Mod-a": selectBlock,
            "Mod-Enter": createEntryBelow,
          }),
          keymap(baseKeymap),
        ]
      : [];

    const editorState = EditorState.create({
      schema: scriptSchema,
      plugins: [...collab.plugins, ...editKeymap],
    });

    view = new EditorView(wrapper, {
      state: editorState,
      editable: () => canEdit,
      handleDOMEvents: {
        mousedown(pmView, event) {
          const target = event.target as HTMLElement;
          const charNameEl = target.closest(".char-name") as HTMLElement | null;
          if (charNameEl) {
            if (target.closest(".char-name-link")) {
              charNameMousedown = {
                x: event.clientX,
                y: event.clientY,
                target: charNameEl,
              };
            }
            return true;
          }
          if (target.closest(".drag-handle")) {
            return true;
          }
          if (
            !target.closest(".choice-text") &&
            !target.closest(".dialogue-lines .line") &&
            !target.closest(".choice-checkbox")
          ) {
            const y = event.clientY;
            const candidates = pmView.dom.querySelectorAll<HTMLElement>(
              ".choice, .dialogue-lines .line",
            );
            for (const el of candidates) {
              const rect = el.getBoundingClientRect();
              if (y >= rect.top && y <= rect.bottom) {
                const textEl = el.classList.contains("choice")
                  ? el.querySelector(".choice-text")
                  : el;
                if (textEl) {
                  event.preventDefault();
                  const pos = pmView.posAtDOM(textEl, textEl.childNodes.length);
                  const tr = pmView.state.tr.setSelection(
                    TextSelection.create(pmView.state.doc, pos),
                  );
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
                (node.type.name === "dialogue" ||
                  node.type.name === "choice") &&
                node.attrs.next &&
                removed.has(node.attrs.next)
              ) {
                fixTr = fixTr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  next: null,
                });
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

    requestAnimationFrame(() => refresh(view));
    addGlobalListener(window, "resize", () => scheduleRefresh(view));
    if (canEdit) {
      setupArrowInteraction(view);
      setupDragDrop(view);
    }

    // Remote editing indicators on char-name headers
    function updateEditingIndicators() {
      const obs = (view as any).domObserver;
      obs?.stop?.();
      view.dom
        .querySelectorAll(".editing-indicator")
        .forEach((el) => el.remove());
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

        const entryEl = view.dom.querySelector(
          `.entry[data-entry-id="${editingId}"]`,
        );
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

      let depth = $pos.depth;
      while (depth > 0 && $pos.node(depth).type.name !== "choice") depth--;
      if (depth === 0) return;

      const choiceNode = $pos.node(depth);
      const choicePos = $pos.before(depth);
      const newChecked = !choiceNode.attrs.checked;

      const decisionNode = $pos.node(depth - 1);
      let allWouldBeChecked = true;
      decisionNode.forEach((child) => {
        if (child.type.name === "choice") {
          const wouldBe =
            child === choiceNode ? newChecked : child.attrs.checked;
          if (!wouldBe) allWouldBeChecked = false;
        }
      });

      let tr = view.state.tr;
      if (allWouldBeChecked) {
        const decisionPos = $pos.before(depth - 1);
        let offset = 1;
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

  // Return cleanup function
  return () => {
    destroyed = true;

    // Remove all global listeners
    for (const { target, type, handler, capture } of globalListeners) {
      target.removeEventListener(type, handler, capture);
    }
    globalListeners.length = 0;

    // Close any active JSON editor
    if (activeJsonEditor) {
      activeJsonEditor.cmView.destroy();
      activeJsonEditor.popup.remove();
      activeJsonEditor.cleanup();
      activeJsonEditor = null;
    }

    // Destroy EditorView
    if (view) {
      view.destroy();
    }

    // Destroy collab (provider + ydoc)
    collab.destroy();

    // Clear DOM
    appEl.innerHTML = "";
  };
}

// --- Route setup ---

const appEl = document.querySelector<HTMLElement>("#app")!;

route("/", () => {
  const cleanup = mountDocList(appEl, currentUser);
  onCleanup(cleanup);
});

route("/d/:docId", (params) => {
  // Show loading state while fetching permission
  appEl.innerHTML = "";
  const loading = document.createElement("div");
  loading.textContent = "Loading...";
  loading.style.padding = "2rem";
  loading.style.color = "#888";
  appEl.appendChild(loading);

  fetch(`/api/documents/${encodeURIComponent(params.docId)}/can-edit`)
    .then((r) => r.json())
    .then((data) => {
      appEl.innerHTML = "";
      const cleanup = mountEditor(appEl, params.docId, data.canEdit, data.isOwner);
      onCleanup(cleanup);
    })
    .catch(() => {
      appEl.innerHTML = "";
      const cleanup = mountEditor(appEl, params.docId, false, false);
      onCleanup(cleanup);
    });
});

// Fetch auth state before resolving routes
fetch("/api/me")
  .then((r) => r.json())
  .then((user) => {
    currentUser = user;
  })
  .catch(() => {
    currentUser = null;
  })
  .finally(() => {
    resolve();
  });
