import { NUM_OF_NODES, UNDEF_NODE, walkMatrix } from './calcpath-data.js';

// DFS pathfinding over walkMatrix (port of calcpath.c).
// Returns a randomly chosen path: [fromNode, ...intermediates, toNode, UNDEF_NODE].
// When fromNode === toNode, returns [fromNode, UNDEF_NODE].
export function calcPath(fromNode: number, toNode: number): number[] {
  const paths: number[][] = [];
  const isMarked = new Uint8Array(NUM_OF_NODES);
  const fromParent = new Int32Array(NUM_OF_NODES);

  isMarked[fromNode] = 1;
  fromParent[fromNode] = UNDEF_NODE;

  let pathLen = 1;

  function recurse(prevNode: number, curNode: number): void {
    if (curNode === toNode) {
      const path = new Array<number>(pathLen + 1);
      let node = curNode;
      for (let i = pathLen - 1; i >= 0; i--) {
        path[i] = node;
        node = fromParent[node]!;
      }
      path[pathLen] = UNDEF_NODE;
      paths.push(path);
      return;
    }

    for (let next = 0; next < NUM_OF_NODES; next++) {
      if (walkMatrix[prevNode]![curNode]![next] && !isMarked[next]) {
        isMarked[next] = 1;
        fromParent[next] = curNode;
        pathLen++;
        recurse(curNode, next);
        isMarked[next] = 0;
        pathLen--;
      }
    }
  }

  recurse(UNDEF_NODE, fromNode);

  return paths[Math.floor(Math.random() * paths.length)]!;
}
