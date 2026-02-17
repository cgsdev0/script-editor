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
          ["div", { class: "char-name", contenteditable: "false", draggable: "true" }, node.attrs.char],
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
          ["div", { class: "char-name", contenteditable: "false", draggable: "true" }, "PLAYER"],
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
        return [
          "div",
          attrs,
          ["input", { type: "checkbox", class: "choice-checkbox", contenteditable: "false" }],
          ["span", { class: "drag-handle", contenteditable: "false", draggable: "true" }, "\u2847"],
          ["span", { class: "choice-text" }, 0],
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
  root.querySelectorAll(".arrow-svg").forEach((el) => el.remove());
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
    root.appendChild(svg);
  }

  if (upArrows.length) {
    const svg = makeSvg("right");
    addPaths(svg, upArrows, assignColumns(upArrows), "right");
    root.appendChild(svg);
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

    root.appendChild(seqSvg);
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

    root.appendChild(exitSvg);
  }
}

function setupArrowInteraction(view: EditorView) {
  const root = view.dom;

  // --- click to select connection arrows ---
  root.addEventListener("click", (e) => {
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

  root.addEventListener("mousedown", (e) => {
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
    root.appendChild(dragOverlay);

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

    // highlight entry under cursor
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const entry = el?.closest(".entry") as HTMLElement | null;

    if (hoveredEntry && hoveredEntry !== entry) {
      hoveredEntry.classList.remove("connect-target");
    }
    if (entry && entry !== hoveredEntry) {
      entry.classList.add("connect-target");
    }
    hoveredEntry = entry;
  }

  function onDragEnd(e: MouseEvent) {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);

    if (hoveredEntry) {
      hoveredEntry.classList.remove("connect-target");
      const targetId = hoveredEntry.dataset.entryId;

      if (targetId && dragSourceEl) {
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
    e.dataTransfer!.effectAllowed = "move";
    dragSource.classList.add("dragging");
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
    clearIndicators();

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

  function clearIndicators() {
    dom.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((el) =>
      el.classList.remove("drag-over-top", "drag-over-bottom"),
    );
  }

  function cleanup() {
    dom
      .querySelectorAll(".dragging, .drag-over-top, .drag-over-bottom")
      .forEach((el) => {
        el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
      });
    dragSource = null;
    dragType = null;
  }
}

function updateVisibility(root: HTMLElement) {
  const entries = root.querySelectorAll<HTMLElement>(".entry[data-entry-id]");
  const hasAnyChecks =
    root.querySelector<HTMLInputElement>(".choice-checkbox:checked") !== null;

  // reset
  entries.forEach((e) => e.classList.remove("entry-hidden"));
  root
    .querySelectorAll(".choice")
    .forEach((e) => e.classList.remove("choice-dimmed"));

  if (!hasAnyChecks) return;

  // gray out unchecked choices in decisions that have at least one check
  root.querySelectorAll(".decision").forEach((decision) => {
    const checked = decision.querySelectorAll(".choice-checkbox:checked");
    if (checked.length > 0) {
      decision.querySelectorAll(".choice").forEach((choice) => {
        const cb = choice.querySelector<HTMLInputElement>(".choice-checkbox");
        if (!cb?.checked) choice.classList.add("choice-dimmed");
      });
    }
  });

  // walk the graph from all root entries (entries not targeted by any next)
  const allNextTargets = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-next]").forEach((el) => {
    allNextTargets.add(el.dataset.next!);
  });

  const rootIds: string[] = [];
  entries.forEach((entry) => {
    const id = entry.dataset.entryId!;
    if (!allNextTargets.has(id)) rootIds.push(id);
  });

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
      const checked = decision.querySelectorAll<HTMLInputElement>(
        ".choice-checkbox:checked",
      );
      if (checked.length > 0) {
        checked.forEach((cb) => {
          const choice = cb.closest<HTMLElement>(".choice");
          if (choice?.dataset.next) walk(choice.dataset.next);
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

  rootIds.forEach((id) => walk(id));

  entries.forEach((entry) => {
    if (!reachable.has(entry.dataset.entryId!)) {
      entry.classList.add("entry-hidden");
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

function refresh(view: EditorView) {
  updateVisibility(view.dom);
  labelEntrypoints(view.dom);
  drawArrows(view);
}

const doc = linesToDoc(lines);
const state = EditorState.create({ doc });

const view = new EditorView(document.querySelector("#app")!, {
  state,
  editable: () => false,
});

// draw arrows after initial render
requestAnimationFrame(() => refresh(view));
setupArrowInteraction(view);
setupDragDrop(view);

// checkbox changes
view.dom.addEventListener("change", (e) => {
  const cb = e.target as HTMLInputElement;
  if (!cb.classList.contains("choice-checkbox")) return;

  const decision = cb.closest(".decision");
  if (decision) {
    const all = decision.querySelectorAll<HTMLInputElement>(".choice-checkbox");
    const allChecked = [...all].every((c) => c.checked);
    if (allChecked) {
      all.forEach((c) => (c.checked = false));
    }
  }

  requestAnimationFrame(() => refresh(view));
});
