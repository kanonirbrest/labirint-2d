/**
 * Генерация идеального лабиринта методом итеративного DFS (алгоритм обхода в глубину).
 * cells[y][x] = { n, e, s, w } — true означает наличие стены в соответствующем направлении.
 */
export function generateMaze(width, height) {
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ n: true, e: true, s: true, w: true }))
  );

  const visited = Array.from({ length: height }, () => new Array(width).fill(false));

  const opposite = { n: 's', e: 'w', s: 'n', w: 'e' };
  const deltas = {
    n: { dx: 0, dy: -1 },
    e: { dx: 1, dy: 0 },
    s: { dx: 0, dy: 1 },
    w: { dx: -1, dy: 0 },
  };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const stack = [{ x: 0, y: 0 }];
  visited[0][0] = true;

  while (stack.length > 0) {
    const { x, y } = stack[stack.length - 1];
    const dirs = shuffle(['n', 'e', 's', 'w']);
    let moved = false;

    for (const dir of dirs) {
      const { dx, dy } = deltas[dir];
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
        cells[y][x][dir] = false;
        cells[ny][nx][opposite[dir]] = false;
        visited[ny][nx] = true;
        stack.push({ x: nx, y: ny });
        moved = true;
        break;
      }
    }

    if (!moved) stack.pop();
  }

  return cells;
}

/**
 * BFS поиск кратчайшего пути в лабиринте от start до end.
 * Возвращает массив клеток [{x,y}, ...] включая start и end, или null если пути нет.
 */
export function findPath(cells, start, end) {
  const height = cells.length;
  const width = cells[0].length;

  const startKey = `${start.x},${start.y}`;
  const endKey = `${end.x},${end.y}`;

  if (startKey === endKey) return [start];

  const queue = [startKey];
  const parent = new Map([[startKey, null]]);

  const deltas = [
    { dx: 0, dy: -1, wall: 'n' },
    { dx: 1, dy: 0, wall: 'e' },
    { dx: 0, dy: 1, wall: 's' },
    { dx: -1, dy: 0, wall: 'w' },
  ];

  while (queue.length > 0) {
    const currentKey = queue.shift();

    if (currentKey === endKey) {
      const path = [];
      let key = endKey;
      while (key !== null) {
        const [x, y] = key.split(',').map(Number);
        path.unshift({ x, y });
        key = parent.get(key);
      }
      return path;
    }

    const [cx, cy] = currentKey.split(',').map(Number);
    const cell = cells[cy][cx];

    for (const { dx, dy, wall } of deltas) {
      if (!cell[wall]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nKey = `${nx},${ny}`;
        if (!parent.has(nKey) && nx >= 0 && nx < width && ny >= 0 && ny < height) {
          parent.set(nKey, currentKey);
          queue.push(nKey);
        }
      }
    }
  }

  return null;
}

/** Евклидово расстояние между двумя клетками */
export function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
