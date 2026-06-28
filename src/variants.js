// Variant registry — the single source of truth for which Fairy-Stockfish
// variants the experiment panel offers, and the per-variant facts that the
// engine (UCI), the rules layer (ffish), and the board UI (chessgroundx) each
// need. Everything that differs between variants lives here so the rest of the
// app stays variant-agnostic.
//
// Phase: this first pass covers the variants that render on the standard 8×8
// board with the cburnett piece set — i.e. no new board geometry or piece art
// required. Shogi / xiangqi / capablanca (different dimensions + piece sets)
// slot in later by adding entries with `dim`/`pieceSet` set and shipping the
// matching CSS.
//
// Field reference:
//   key          unique id used in the UI/URL.
//   label        human label for the dropdown.
//   engine       UCI_Variant value sent to Fairy-Stockfish.
//   ffish        variant name handed to ffish's Board (usually === engine).
//   chess960     send UCI_Chess960=true and start from a random 960 position.
//   pocket       true for drop variants (crazyhouse): show pockets, allow drops.
//   promo        promotion target roles offered to the player, in menu order,
//                or null if the variant never promotes. Roles are chessgroundx
//                role ids minus the '-piece' suffix (q,r,b,n,k...).
//   blurb        one-liner shown under the board so you know what you're playing.

export const VARIANTS = [
  {
    key: 'chess',
    label: 'Standard chess',
    engine: 'chess',
    ffish: 'chess',
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Ordinary chess. The baseline.',
  },
  {
    key: 'chess960',
    label: 'Chess960 (Fischer random)',
    engine: 'chess',
    ffish: 'chess',
    chess960: true,
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Back rank shuffled to one of 960 random setups. Same rules otherwise.',
  },
  {
    key: 'crazyhouse',
    label: 'Crazyhouse',
    engine: 'crazyhouse',
    ffish: 'crazyhouse',
    pocket: true,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Captured pieces switch sides and can be dropped back onto the board.',
  },
  {
    key: 'kingofthehill',
    label: 'King of the Hill',
    engine: 'kingofthehill',
    ffish: 'kingofthehill',
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Get your king to one of the four centre squares to win instantly.',
  },
  {
    key: '3check',
    label: 'Three-check',
    engine: '3check',
    ffish: '3check',
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Check the enemy king three times and you win — checkmate optional.',
  },
  {
    key: 'atomic',
    label: 'Atomic',
    engine: 'atomic',
    ffish: 'atomic',
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'Captures explode, wiping out adjacent non-pawns. Blow up the king to win.',
  },
  {
    key: 'antichess',
    label: 'Antichess',
    engine: 'antichess',
    ffish: 'antichess',
    pocket: false,
    // Antichess has no royal king, so a pawn may even promote to a king.
    promo: ['q', 'r', 'b', 'n', 'k'],
    blurb: 'Capturing is forced. Lose all your pieces (or get stalemated) to win.',
  },
  {
    key: 'horde',
    label: 'Horde',
    engine: 'horde',
    ffish: 'horde',
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: 'White fields a horde of 36 pawns vs. a full black army. Mate Black, or wipe the horde.',
  },
  {
    key: 'racingkings',
    label: 'Racing Kings',
    engine: 'racingkings',
    ffish: 'racingkings',
    pocket: false,
    promo: null,
    blurb: 'No pawns, no checks allowed. First king to reach the 8th rank wins.',
  },
];

const BY_KEY = new Map(VARIANTS.map((v) => [v.key, v]));

export function getVariant(key) {
  return BY_KEY.get(key) || VARIANTS[0];
}

// chessgroundx pocketRoles for a drop variant: which roles sit in each pocket.
// (The pocket starts empty; this just declares the slots/order.)
export function pocketRoles(variant) {
  if (!variant.pocket) return undefined;
  const roles = ['p-piece', 'n-piece', 'b-piece', 'r-piece', 'q-piece'];
  return { white: roles, black: roles };
}
