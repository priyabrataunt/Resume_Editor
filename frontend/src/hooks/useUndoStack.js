import { useState, useCallback } from 'react';

export function useUndoStack() {
  const [stack, setStack] = useState([]); // [{ old: string, new: string }]

  const push = useCallback((entry) => {
    setStack(prev => [...prev, entry]);
  }, []);

  const pop = useCallback(() => {
    if (stack.length === 0) return null;
    const entry = stack[stack.length - 1];
    setStack(stack.slice(0, -1));
    return entry;
  }, [stack]);

  const canUndo = stack.length > 0;

  return { push, pop, canUndo, stackSize: stack.length };
}
