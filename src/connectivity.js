// Board connectivity — pure helpers for wall-carved boards (Session W,
// GAME-LOOP-PLAN.md).
//
// Walls (`*` squares) can split a board into disconnected regions. If the two
// armies can never reach each other the game is an unwinnable staring contest,
// so the board generators treat "armies connected" as a hard guardrail; the
// editor surfaces it as a soft warning (you may build whatever you like, but
// you're told when it's inert).
//
// Reachability model: 8-way adjacency (king steps) over non-wall squares.
// That's the conservative baseline — any region a king can traverse, every
// non-jumping piece can too. Knights can hop 1-thick walls, so a board that is
// "sealed" here can still be knight-porous; refine in the generators if a
// knight-only bridge should ever count. Pieces are treated as passable (they
// move away over time); only walls block.

// Parse a FEN placement (board part only) into a rectangular cell grid.
// rows[0] is the TOP rank (FEN order); each cell is '' (empty), '*' (wall), or
// the piece letter. Tolerates the FEN piece modifiers (+ promoted prefix,
// ~ promoted suffix, | mirror) by attributing them to their piece.
export function parseGrid(placement) {
  const rows = [];
  for (const rank of placement.split('/')) {
    const cells = [];
    let num = 0;
    for (const ch of rank) {
      if (ch >= '0' && ch <= '9') {
        num = num * 10 + (ch.charCodeAt(0) - 48);
        continue;
      }
      for (; num > 0; num--) cells.push('');
      if (ch === '*') cells.push('*');
      else if (ch === '~' || ch === '+' || ch === '|') continue;
      else cells.push(ch);
    }
    for (; num > 0; num--) cells.push('');
    rows.push(cells);
  }
  return rows;
}

// Flood-fill analysis of a placement FEN. Returns:
//   regions          number of 8-connected non-wall regions
//   walls            number of wall squares
//   armiesConnected  true if some region holds pieces of BOTH colors,
//                    false if both sides have pieces but never share a region,
//                    null if either side has no pieces (nothing to say)
export function analyzeConnectivity(placement) {
  const rows = parseGrid(placement);
  const h = rows.length;
  const region = rows.map((r) => r.map(() => -1));
  let regions = 0;
  let walls = 0;

  for (let r = 0; r < h; r++) {
    for (let f = 0; f < rows[r].length; f++) {
      if (rows[r][f] === '*') {
        walls++;
        continue;
      }
      if (region[r][f] !== -1) continue;
      // New region: flood fill from here.
      const stack = [[r, f]];
      region[r][f] = regions;
      while (stack.length) {
        const [cr, cf] = stack.pop();
        for (let dr = -1; dr <= 1; dr++) {
          for (let df = -1; df <= 1; df++) {
            if (!dr && !df) continue;
            const nr = cr + dr;
            const nf = cf + df;
            if (nr < 0 || nr >= h || nf < 0 || !rows[nr] || nf >= rows[nr].length) continue;
            if (rows[nr][nf] === '*' || region[nr][nf] !== -1) continue;
            region[nr][nf] = regions;
            stack.push([nr, nf]);
          }
        }
      }
      regions++;
    }
  }

  // Which regions hold white / black pieces?
  const white = new Set();
  const black = new Set();
  for (let r = 0; r < h; r++) {
    for (let f = 0; f < rows[r].length; f++) {
      const c = rows[r][f];
      if (!c || c === '*') continue;
      (c === c.toUpperCase() ? white : black).add(region[r][f]);
    }
  }
  let armiesConnected = null;
  if (white.size && black.size) {
    armiesConnected = [...white].some((id) => black.has(id));
  }
  return { regions, walls, armiesConnected };
}
