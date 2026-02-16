/**
 * GraphEditor — Top-level React component wrapping ReactFlow.
 *
 * Handles: onConnect, onEdgesDelete, onNodesDelete, onNodeDragStop,
 * pane double-click, auto-arrange toolbar.
 */

import { useCallback } from "react";
import {
  ReactFlow,
  Panel,
  Background,
  BackgroundVariant,
  useReactFlow,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodesDelete,
  ReactFlowProvider,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type OnReconnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type * as Y from "yjs";
import {
  createScene,
  deleteScene,
  setNodePosition,
  setChoiceTarget,
  setAutoTransition,
  addChoice,
} from "../crdt/index.ts";
import { useCRDTSync } from "./useCRDTSync.ts";
import { getVisibleSceneIds } from "./graphUtils.ts";
import { relayoutAll } from "./layout.ts";
import SceneNode from "./SceneNode.tsx";
import "./styles.css";

const nodeTypes = { sceneNode: SceneNode };
const defaultEdgeOptions = { type: "smoothstep", reconnectable: true };

function GraphEditorInner({ doc }: { doc: Y.Doc }) {
  const { nodes, setNodes, edges, setEdges, isSyncing, rebuild } = useCRDTSync(doc);
  const { screenToFlowPosition } = useReactFlow();

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges],
  );

  // Drag stop → persist position to CRDT
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      isSyncing.current = true;
      try {
        setNodePosition(doc, node.id, node.position.x, node.position.y);
      } finally {
        isSyncing.current = false;
      }
    },
    [doc, isSyncing],
  );

  // Connect handle → set choice target or create new choice
  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target) return;
      const sourceHandle = connection.sourceHandle || "";
      const targetSceneId = connection.target;

      isSyncing.current = true;
      try {
        if (sourceHandle === "__auto__") {
          setAutoTransition(doc, connection.source, targetSceneId);
        } else if (sourceHandle === "__default__") {
          // New choice from default handle
          addChoice(doc, connection.source, { text: "", target: targetSceneId });
        } else {
          // Reconnect existing choice
          setChoiceTarget(doc, connection.source, sourceHandle, targetSceneId);
        }
      } finally {
        isSyncing.current = false;
      }
      rebuild();
    },
    [doc, isSyncing, rebuild],
  );

  // Reconnect edge → update choice target or autoTransition to new node
  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      if (!newConnection.source || !newConnection.target) return;
      const sourceHandle = oldEdge.sourceHandle || "";
      const newTarget = newConnection.target;

      isSyncing.current = true;
      try {
        if (sourceHandle === "__auto__") {
          setAutoTransition(doc, oldEdge.source, newTarget);
        } else if (sourceHandle !== "__default__") {
          setChoiceTarget(doc, oldEdge.source, sourceHandle, newTarget);
        }
      } finally {
        isSyncing.current = false;
      }
      rebuild();
    },
    [doc, isSyncing, rebuild],
  );

  // Delete edges → remove choice target or clear autoTransition
  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deletedEdges) => {
      isSyncing.current = true;
      try {
        for (const edge of deletedEdges) {
          const sourceHandle = edge.sourceHandle || "";
          if (sourceHandle === "__auto__") {
            setAutoTransition(doc, edge.source, undefined);
          } else if (sourceHandle !== "__default__") {
            // Clear the choice target instead of deleting the choice
            setChoiceTarget(doc, edge.source, sourceHandle, "");
          }
        }
      } finally {
        isSyncing.current = false;
      }
      rebuild();
    },
    [doc, isSyncing, rebuild],
  );

  // Delete nodes → delete scene from CRDT
  const onNodesDelete: OnNodesDelete = useCallback(
    (deletedNodes) => {
      isSyncing.current = true;
      try {
        for (const node of deletedNodes) {
          deleteScene(doc, node.id);
        }
      } finally {
        isSyncing.current = false;
      }
      rebuild();
    },
    [doc, isSyncing, rebuild],
  );

  // Double-click pane → create new scene
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Only on pane background, not on nodes
      const target = event.target as HTMLElement;
      if (target.closest(".react-flow__node")) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const sceneId = createScene(doc);
      isSyncing.current = true;
      try {
        setNodePosition(doc, sceneId, position.x, position.y);
      } finally {
        isSyncing.current = false;
      }
      rebuild();
    },
    [doc, screenToFlowPosition, isSyncing, rebuild],
  );

  // Auto-arrange
  const handleAutoArrange = useCallback(() => {
    const sceneIds = getVisibleSceneIds(doc);
    relayoutAll(doc, sceneIds);
    // Force re-read positions
    isSyncing.current = true;
    try {
      rebuild();
    } finally {
      isSyncing.current = false;
    }
  }, [doc, isSyncing, rebuild]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onEdgesDelete={onEdgesDelete}
      onNodesDelete={onNodesDelete}
      onNodeDragStop={onNodeDragStop}
      onDoubleClick={onDoubleClick}
      fitView
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={defaultEdgeOptions}
      deleteKeyCode="Delete"
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Panel position="top-left">
        <div className="graph-toolbar">
          <button onClick={handleAutoArrange}>Auto-arrange</button>
        </div>
      </Panel>
    </ReactFlow>
  );
}

export default function GraphEditor({ doc }: { doc: Y.Doc }) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner doc={doc} />
    </ReactFlowProvider>
  );
}
