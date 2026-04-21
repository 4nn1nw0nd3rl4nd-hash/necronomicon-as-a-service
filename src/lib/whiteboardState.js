function upsertById(items, nextItem) {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  const copy = [...items];
  copy[existingIndex] = { ...copy[existingIndex], ...nextItem };
  return copy;
}

export const initialWhiteboardState = {
  images: [],
  notes: [],
  tokens: {},
};

export function applyWhiteboardAction(state, action) {
  switch (action.type) {
    case "add_image":
      return {
        ...state,
        images: upsertById(state.images, action.image),
      };
    case "move_image":
      return {
        ...state,
        images: state.images.map((image) =>
          image.id === action.targetId ? { ...image, x: action.x, y: action.y } : image
        ),
      };
    case "toggle_image_visibility":
      return {
        ...state,
        images: state.images.map((image) =>
          image.id === action.targetId ? { ...image, revealed: action.revealed } : image
        ),
      };
    case "add_note":
      return {
        ...state,
        notes: upsertById(state.notes, action.note),
      };
    case "move_note":
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === action.targetId ? { ...note, x: action.x, y: action.y } : note
        ),
      };
    case "move_token":
      return {
        ...state,
        tokens: {
          ...state.tokens,
          [action.userId]: {
            ...(state.tokens[action.userId] || {}),
            x: action.x,
            y: action.y,
          },
        },
      };
    default:
      return state;
  }
}
