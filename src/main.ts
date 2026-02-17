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
      toDOM(): DOMOutputSpec {
        return ["section", { class: "entry" }, 0];
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
        return [
          "div",
          { class: "dialogue" },
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
        return ["div", { class: "decision" }, 0];
      },
    },
    choice: {
      attrs: {
        next: { default: null },
        effect: { default: null },
        cond: { default: null },
      },
      content: "text*",
      toDOM(): DOMOutputSpec {
        return ["div", { class: "choice" }, 0];
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

const doc = linesToDoc(lines);
const state = EditorState.create({ doc });

new EditorView(document.querySelector("#app")!, {
  state,
  editable: () => false,
});
