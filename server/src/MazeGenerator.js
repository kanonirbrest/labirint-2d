/**
 * Генерация лабиринта с разными стилями сложности:
 *  - 'easy':   прямолинейные коридоры (bias к продолжению прямо)
 *  - 'normal': стандартный DFS
 *  - 'hard':   запутанный DFS + дополнительные петли (ложные пути)
 */
export function generateMaze(width, height, style = 'normal') {
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ n: true, e: true, s: true, w: true }))
  );

  const visited = Array.from({ length: height }, () => new Array(width).fill(false));

  const opposite = { n: 's', e: 'w', s: 'n', w: 'e' };
  const deltas   = { n:{dx:0,dy:-1}, e:{dx:1,dy:0}, s:{dx:0,dy:1}, w:{dx:-1,dy:0} };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Итеративный DFS с опциональным bias
  const stack = [{ x: 0, y: 0, fromDir: null }];
  visited[0][0] = true;

  // Вероятность продолжать прямо (для easy)
  const straightBias = style === 'easy' ? 0.68 : 0;

  while (stack.length > 0) {
    const { x, y, fromDir } = stack[stack.length - 1];
    const dirs = shuffle(['n', 'e', 's', 'w']);

    // Для easy — ставим «прямое» направление в начало с вероятностью
    if (straightBias > 0 && fromDir && Math.random() < straightBias) {
      const idx = dirs.indexOf(fromDir);
      if (idx !== -1) { dirs.splice(idx, 1); dirs.unshift(fromDir); }
    }

    let moved = false;
    for (const dir of dirs) {
      const { dx, dy } = deltas[dir];
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
        cells[y][x][dir] = false;
        cells[ny][nx][opposite[dir]] = false;
        visited[ny][nx] = true;
        stack.push({ x: nx, y: ny, fromDir: dir });
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // Добавляем петли для всех стилей (больше проходов = меньше тупиков)
  // easy: ~18% — очень открытый лабиринт
  // normal: ~14% — заметно больше развилок
  // hard: ~18% — огромный с кучей ложных путей
  const loopPct = style === 'easy' ? 0.18 : style === 'normal' ? 0.14 : 0.18;
  const loops = Math.floor(width * height * loopPct);
  for (let i = 0; i < loops; i++) {
    const x = 1 + Math.floor(Math.random() * (width  - 2));
    const y = 1 + Math.floor(Math.random() * (height - 2));
    const dir = ['n', 'e', 's', 'w'][Math.floor(Math.random() * 4)];
    const { dx, dy } = deltas[dir];
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      cells[y][x][dir] = false;
      cells[ny][nx][opposite[dir]] = false;
    }
  }

  return cells;
}

/** BFS кратчайший путь. Возвращает [{x,y},...] или null */
export function findPath(cells, start, end) {
  const h = cells.length, w = cells[0].length;
  const startKey = `${start.x},${start.y}`;
  const endKey   = `${end.x},${end.y}`;
  if (startKey === endKey) return [start];

  const queue = [startKey];
  const parent = new Map([[startKey, null]]);
  const deltas = [
    { dx:0,dy:-1,wall:'n' }, { dx:1,dy:0,wall:'e' },
    { dx:0,dy:1,wall:'s' },  { dx:-1,dy:0,wall:'w' },
  ];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === endKey) {
      const path = [];
      let k = endKey;
      while (k !== null) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x, y });
        k = parent.get(k);
      }
      return path;
    }
    const [cx, cy] = cur.split(',').map(Number);
    for (const { dx, dy, wall } of deltas) {
      if (cells[cy][cx][wall]) continue;
      const nx = cx + dx, ny = cy + dy;
      const nk = `${nx},${ny}`;
      if (!parent.has(nk) && nx >= 0 && nx < w && ny >= 0 && ny < h) {
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
  }
  return null;
}

export function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
