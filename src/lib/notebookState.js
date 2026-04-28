function upsertPage(pages, nextPage) {
  const existingIndex = pages.findIndex((page) => page.userId === nextPage.userId);

  if (existingIndex === -1) {
    return [...pages, nextPage];
  }

  const copy = [...pages];
  copy[existingIndex] = { ...copy[existingIndex], ...nextPage };
  return copy;
}

export const initialNotebookState = {
  pages: [],
};

export function applyNotebookAction(state, action) {
  switch (action.type) {
    case "upsert_page":
      return {
        ...state,
        pages: upsertPage(state.pages, action.page),
      };
    default:
      return state;
  }
}
