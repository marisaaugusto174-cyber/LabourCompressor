import {
  createTaxonomyChangeSet,
  createTaxonomyPath,
  type TaxonomyChangeSet,
  type TaxonomyMovedNode,
  type TaxonomyRenamedNode
} from './taxonomy-domain.ts';
import { type ParsedTaxonomyTree } from './taxonomy-markdown-parser.ts';

export function diffTaxonomyTrees(input: {
  readonly previousTree: ParsedTaxonomyTree;
  readonly nextTree: ParsedTaxonomyTree;
}): TaxonomyChangeSet {
  const previousNodesByPath = new Map(
    input.previousTree.nodes.map((node) => [node.path.value, node] as const)
  );
  const nextNodesByPath = new Map(
    input.nextTree.nodes.map((node) => [node.path.value, node] as const)
  );

  return createTaxonomyChangeSet({
    addedPaths: input.nextTree.nodes
      .filter((node) => !previousNodesByPath.has(node.path.value))
      .map((node) => createTaxonomyPath({ segments: node.path.segments })),
    removedPaths: input.previousTree.nodes
      .filter((node) => !nextNodesByPath.has(node.path.value))
      .map((node) => createTaxonomyPath({ segments: node.path.segments })),
    movedNodes: detectMovedNodes(input.previousTree, input.nextTree),
    renamedNodes: detectRenamedNodes(input.previousTree, input.nextTree)
  });
}

function detectMovedNodes(
  previousTree: ParsedTaxonomyTree,
  nextTree: ParsedTaxonomyTree
): readonly TaxonomyMovedNode[] {
  const previousByLabel = groupUniqueNodesByLabel(previousTree);
  const nextByLabel = groupUniqueNodesByLabel(nextTree);
  const movedNodes: TaxonomyMovedNode[] = [];

  for (const [label, previousNode] of previousByLabel) {
    const nextNode = nextByLabel.get(label);

    if (
      nextNode === undefined ||
      previousNode.path.value === nextNode.path.value ||
      previousNode.depth !== nextNode.depth
    ) {
      continue;
    }

    movedNodes.push(
      Object.freeze({
        nodeId: nextNode.id,
        fromPath: previousNode.path,
        toPath: nextNode.path
      })
    );
  }

  return Object.freeze(movedNodes);
}

function detectRenamedNodes(
  previousTree: ParsedTaxonomyTree,
  nextTree: ParsedTaxonomyTree
): readonly TaxonomyRenamedNode[] {
  const previousByParent = groupNodesByParentPath(previousTree);
  const nextByParent = groupNodesByParentPath(nextTree);
  const renamedNodes: TaxonomyRenamedNode[] = [];

  for (const [parentPath, previousNodes] of previousByParent) {
    const nextNodes = nextByParent.get(parentPath);

    if (nextNodes === undefined) {
      continue;
    }

    const removedCandidates = previousNodes.filter(
      (node) => !nextTree.nodeIdsByPath[node.path.value]
    );
    const addedCandidates = nextNodes.filter(
      (node) => !previousTree.nodeIdsByPath[node.path.value]
    );

    if (removedCandidates.length !== 1 || addedCandidates.length !== 1) {
      continue;
    }

    const removedNode = removedCandidates[0]!;
    const addedNode = addedCandidates[0]!;

    if (removedNode.depth !== addedNode.depth) {
      continue;
    }

    renamedNodes.push(
      Object.freeze({
        nodeId: addedNode.id,
        fromLabel: removedNode.label,
        toLabel: addedNode.label,
        path: addedNode.path
      })
    );
  }

  return Object.freeze(renamedNodes);
}

function groupUniqueNodesByLabel(
  tree: ParsedTaxonomyTree
): Map<string, ParsedTaxonomyTree['nodes'][number]> {
  const groupedNodes = new Map<string, ParsedTaxonomyTree['nodes'][number][]>();

  for (const node of tree.nodes) {
    const group = groupedNodes.get(node.label) ?? [];
    group.push(node);
    groupedNodes.set(node.label, group);
  }

  return new Map(
    [...groupedNodes.entries()]
      .filter(([, nodes]) => nodes.length === 1)
      .map(([label, nodes]) => [label, nodes[0]!])
  );
}

function groupNodesByParentPath(
  tree: ParsedTaxonomyTree
): Map<string, readonly ParsedTaxonomyTree['nodes'][number][]> {
  const nodesById = new Map(tree.nodes.map((node) => [node.id, node] as const));
  const groupedNodes = new Map<string, ParsedTaxonomyTree['nodes'][number][]>();

  for (const node of tree.nodes) {
    const parentPath =
      node.parentId === undefined
        ? '__ROOT__'
        : nodesById.get(node.parentId)?.path.value ?? '__ROOT__';
    const group = groupedNodes.get(parentPath) ?? [];
    group.push(node);
    groupedNodes.set(parentPath, group);
  }

  return new Map(
    [...groupedNodes.entries()].map(([parentPath, nodes]) => [
      parentPath,
      Object.freeze(nodes)
    ])
  );
}
