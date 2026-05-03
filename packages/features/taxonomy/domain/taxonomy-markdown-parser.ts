import {
  createTaxonomyNode,
  createTaxonomyPath,
  type TaxonomyNode,
  type TaxonomyNodeId
} from './taxonomy-domain.ts';

export interface ParsedTaxonomyTree {
  readonly nodes: readonly TaxonomyNode[];
  readonly rootNodeIds: readonly TaxonomyNodeId[];
  readonly nodeIdsByPath: Readonly<Record<string, TaxonomyNodeId>>;
}

const TERMINAL_COUNT_PATTERN = /\s*[（(]末端计数[:：]\s*\d+[)）]\s*$/u;

export function parseTaxonomyMarkdown(
  markdown: string
): ParsedTaxonomyTree {
  const lines = markdown.split(/\r?\n/u);
  const nodeDrafts = new Map<TaxonomyNodeId, TaxonomyNodeDraft>();
  const rootNodeIds: TaxonomyNodeId[] = [];
  const stack: StackEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0 || line.startsWith('> ')) {
      continue;
    }

    if (line.startsWith('## ')) {
      const headingLabel = normalizeLabel(line.slice(3));

      if (headingLabel === undefined) {
        continue;
      }

      stack.length = 0;
      appendNode({
        label: headingLabel,
        depth: 0,
        nodeDrafts,
        rootNodeIds,
        stack
      });
      continue;
    }

    const bulletMatch = /^(\s*)-\s+(.+)$/u.exec(line);

    if (bulletMatch === null) {
      continue;
    }

    const indent = bulletMatch[1] ?? '';
    const bulletLabel = normalizeLabel(bulletMatch[2] ?? '');

    if (bulletLabel === undefined) {
      continue;
    }

    if (indent.includes('\t')) {
      throw new Error('Taxonomy markdown bullets must not use tab indent.');
    }

    const indentWidth = indent.length;

    if (indentWidth % 2 !== 0) {
      throw new Error(
        `Taxonomy markdown bullet indent must use multiples of 2 spaces: "${line}"`
      );
    }

    appendNode({
      label: bulletLabel,
      depth: indentWidth / 2 + 1,
      nodeDrafts,
      rootNodeIds,
      stack
    });
  }

  const nodes = finalizeNodes(nodeDrafts);

  return Object.freeze({
    nodes,
    rootNodeIds: Object.freeze(rootNodeIds),
    nodeIdsByPath: Object.freeze(
      Object.fromEntries(nodes.map((node) => [node.path.value, node.id]))
    )
  });
}

interface AppendNodeInput {
  readonly label: string;
  readonly depth: number;
  readonly nodeDrafts: Map<TaxonomyNodeId, TaxonomyNodeDraft>;
  readonly rootNodeIds: TaxonomyNodeId[];
  readonly stack: StackEntry[];
}

interface StackEntry {
  readonly depth: number;
  readonly label: string;
  readonly nodeId: TaxonomyNodeId;
}

interface TaxonomyNodeDraft {
  readonly id: TaxonomyNodeId;
  readonly label: string;
  readonly depth: number;
  readonly parentId?: TaxonomyNodeId;
  readonly pathSegments: readonly string[];
  readonly childIds: TaxonomyNodeId[];
}

function appendNode(input: AppendNodeInput): void {
  while (
    input.stack.length > 0 &&
    input.stack[input.stack.length - 1]?.depth >= input.depth
  ) {
    input.stack.pop();
  }

  const parentEntry = input.stack[input.stack.length - 1];

  if (input.depth > 0 && parentEntry === undefined) {
    throw new Error(
      `Taxonomy markdown contains a nested node without parent: "${input.label}"`
    );
  }

  if (parentEntry !== undefined && parentEntry.depth !== input.depth - 1) {
    throw new Error(
      `Taxonomy markdown depth jump is invalid near node: "${input.label}"`
    );
  }

  const pathSegments = Object.freeze([
    ...(parentEntry === undefined
      ? []
      : getPathSegmentsFromStack(input.stack)),
    input.label
  ]);
  const nodeId = createNodeId(pathSegments);

  if (input.nodeDrafts.has(nodeId)) {
    throw new Error(
      `Duplicate taxonomy path detected: "${pathSegments.join(' > ')}"`
    );
  }

  const nodeDraft: TaxonomyNodeDraft = {
    id: nodeId,
    label: input.label,
    depth: input.depth,
    parentId: parentEntry?.nodeId,
    pathSegments,
    childIds: []
  };

  input.nodeDrafts.set(nodeId, nodeDraft);

  if (parentEntry === undefined) {
    input.rootNodeIds.push(nodeId);
  } else {
    const parentDraft = input.nodeDrafts.get(parentEntry.nodeId);

    if (parentDraft === undefined) {
      throw new Error(
        `Parent taxonomy node missing for child: "${input.label}"`
      );
    }

    parentDraft.childIds.push(nodeId);
  }

  input.stack.push({
    depth: input.depth,
    label: input.label,
    nodeId
  });
}

function finalizeNodes(
  nodeDrafts: Map<TaxonomyNodeId, TaxonomyNodeDraft>
): readonly TaxonomyNode[] {
  return Object.freeze(
    [...nodeDrafts.values()].map((draft) =>
      createTaxonomyNode({
        id: draft.id,
        label: draft.label,
        depth: draft.depth,
        path: createTaxonomyPath({
          segments: draft.pathSegments
        }),
        parentId: draft.parentId,
        childIds: draft.childIds
      })
    )
  );
}

function getPathSegmentsFromStack(
  stack: readonly StackEntry[]
): readonly string[] {
  return stack.map((entry) => entry.label);
}

function createNodeId(pathSegments: readonly string[]): TaxonomyNodeId {
  return `taxonomy-node:${pathSegments.join(' > ')}`;
}

function normalizeLabel(rawLabel: string): string | undefined {
  const withoutTerminalCount = rawLabel
    .replace(TERMINAL_COUNT_PATTERN, '')
    .trim();
  const withoutHeadingIndex = withoutTerminalCount
    .replace(/^\d+\.\s*/u, '')
    .trim();

  if (withoutHeadingIndex.length === 0) {
    return undefined;
  }

  return withoutHeadingIndex;
}
